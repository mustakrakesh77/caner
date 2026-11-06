// Her çalıştığında alınmamış ürünlerin fiyatını Akakçe'den günceller (3 ürün aynı anda).
// Yeni ürünlerde önce Akakçe'de arar, model kodu/ad benzerliğiyle eşleştirir; emin değilse karar kullanıcıya kalır.
import { get, nameFromUrl, parseProduct } from "./akakce.mjs";
import { parseSearch, chooseMatch } from "./match.mjs";
import Cat from "../categories.js";

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL_ || !KEY) {
  console.error("SUPABASE_URL ve SUPABASE_SERVICE_KEY gerekli");
  process.exit(1);
}
const CONCURRENCY = Math.max(1, Number(process.env.SCAN_CONCURRENCY) || 3);
const BASE = process.env.AKAKCE_BASE || "https://www.akakce.com"; // testlerde sahte sunucuya yönlendirmek için

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const rest = (path, opts = {}) => fetch(`${URL_}/rest/v1/${path}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => ms + Math.random() * (ms / 2);
const unassigned = (it) => !it.category || it.category === "Genel";
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const OPTIONAL = ["image_url", "lowest_price", "highest_price", "candidates", "match_state", "match_note", "offers_total"];

const res = await rest("items?purchased=eq.false&select=*");
if (!res.ok) throw new Error("Liste okunamadı: " + (await res.text()));
const items = await res.json();
console.log(`${items.length} ürün taranacak (${Math.min(CONCURRENCY, items.length)} paralel)`);

let ok = 0, fail = 0, ask = 0;

async function scanOne(it) {
  const patch = { last_checked: new Date().toISOString(), last_error: null };

  const persist = async () => {
    const save = () => rest(`items?id=eq.${it.id}`, { method: "PATCH", body: JSON.stringify(patch) });
    let pr = await save();
    if (pr.ok) return;
    const msg = await pr.text();
    if (OPTIONAL.some((k) => k in patch) && /column|schema cache/i.test(msg)) {
      // Yeni sütunlar yoksa temel bilgileri yine de kaydet, sorunu açıkça söyle.
      console.log("⚠ Veritabanında yeni sütunlar eksik. supabase/schema.sql dosyasındaki son bölümü SQL Editor'de çalıştır.");
      OPTIONAL.forEach((k) => delete patch[k]);
      pr = await save();
      if (!pr.ok) console.log(`✗ Kayıt yazılamadı (${it.name}): ${(await pr.text()).slice(0, 200)}`);
    } else {
      console.log(`✗ Kayıt yazılamadı (${it.name}): ${msg.slice(0, 200)}`);
    }
  };

  // Eşleşme seçimi bekleyen ve adayları hazır ürünü boşuna taramayalım.
  if (!it.akakce_url && it.match_state === "pick" && Array.isArray(it.candidates) && it.candidates.length) {
    console.log(`? ${it.name}: eşleşme seçimi bekleniyor`);
    return;
  }

  try {
    let pageUrl = it.akakce_url;
    if (!pageUrl) {
      const fromLink = nameFromUrl(it.source_url || "");
      const query = it.name || fromLink;
      if (!query) throw new Error("Aranacak ürün adı yok");
      const html = await get(BASE + "/arama/?q=" + encodeURIComponent(query));
      const found = parseSearch(html, BASE).slice(0, 10);
      if (!found.length) throw new Error("Akakçe'de eşleşme bulunamadı");

      const d = chooseMatch([it.name, fromLink].filter(Boolean).join(" "), found);
      const strip = ({ url, title, image, price, offers }) => ({ url, title, image, price, offers });
      const ordered = d.candidate ? [d.candidate, ...d.ranked.filter((c) => c.url !== d.candidate.url)] : d.ranked;
      patch.candidates = ordered.slice(0, 6).map(strip);

      if (d.action === "pick" || it.match_state === "pick") {
        // Emin değiliz (ya da kullanıcı başka aday istedi): fiyat çekmiyoruz, seçim bekleniyor.
        patch.match_state = "pick";
        patch.match_note = it.match_state === "pick" ? "Adaylar hazır. Doğru ürünü sen seç." : d.note;
        ask++;
        console.log(`? ${it.name}: ${patch.match_note}`);
        await persist();
        return;
      }
      pageUrl = patch.akakce_url = d.candidate.url;
      patch.match_confirmed = d.verified;
      patch.match_state = d.verified ? "verified" : "guess";
      patch.match_note = d.note;
      await sleep(jitter(300));
    }

    const p = parseProduct(await get(pageUrl));
    if (!p) throw new Error("Fiyat okunamadı");

    if (it.current_price != null && p.price !== Number(it.current_price)) patch.prev_price = it.current_price;
    patch.current_price = p.price;
    patch.lowest_price = it.lowest_price != null ? Math.min(Number(it.lowest_price), p.price) : p.price;
    patch.highest_price = it.highest_price != null ? Math.max(Number(it.highest_price), p.price) : p.price;
    patch.best_store = p.store;
    patch.best_url = p.url;
    patch.offers = p.offers;
    patch.offers_total = p.total;
    if (p.image) patch.image_url = p.image;
    // Ad linkten otomatik çıkarılmışsa (kullanıcı kendi yazmadıysa) Akakçe'deki gerçek adla değiştir.
    if (p.title && (norm(it.name) === norm(nameFromUrl(it.source_url || "")) || it.name === "İsimsiz ürün")) {
      patch.name = p.title;
    }
    // Kategori kullanıcı tarafından seçilmediyse (Otomatik) Akakçe kategorisi + ürün adından ayır.
    if (unassigned(it)) patch.category = Cat.guess(p.title || it.name, pageUrl) || "Diğer";

    await rest("price_history", {
      method: "POST",
      body: JSON.stringify({ item_id: it.id, price: p.price, store: p.store }),
    });
    ok++;
    console.log(`✓ ${it.name}: ${p.price} TL (${p.store}, ${p.offers.length} teklif)${patch.category ? " → " + patch.category : ""}${patch.match_state ? " [" + patch.match_state + "]" : ""}`);
  } catch (e) {
    const raw = String(e.message || e);
    patch.last_error = /HTTP (403|429)/.test(raw)
      ? "Akakçe geçici olarak engelledi, sonraki taramada tekrar denenecek (son fiyat korunuyor)"
      : /timeout|aborted/i.test(raw) ? "Akakçe zamanında yanıt vermedi, sonraki taramada tekrar denenecek" : raw.slice(0, 200);
    if (unassigned(it)) {
      const c = Cat.guess(it.name, it.source_url);
      if (c) patch.category = c;
    }
    fail++;
    console.log(`✗ ${it.name}: ${patch.last_error}`);
  }
  await persist();
}

// İşçi havuzu: her işçi sıradaki ürünü alır; Akakçe'yi yormamak için ürünler arasında kısa bekleme var.
const t0 = Date.now();
let next = 0;
async function worker() {
  while (next < items.length) {
    const it = items[next++];
    await scanOne(it);
    await sleep(jitter(500));
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
console.log(`Bitti: ${ok} başarılı, ${fail} hatalı, ${ask} seçim bekliyor, ${Math.round((Date.now() - t0) / 1000)} sn`);
