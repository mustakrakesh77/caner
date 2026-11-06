// Her çalıştığında alınmamış ürünlerin fiyatını Akakçe'den günceller.
import { get, nameFromUrl, findProductUrl, parseProduct } from "./akakce.mjs";

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL_ || !KEY) {
  console.error("SUPABASE_URL ve SUPABASE_SERVICE_KEY gerekli");
  process.exit(1);
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const rest = (path, opts = {}) => fetch(`${URL_}/rest/v1/${path}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const res = await rest("items?purchased=eq.false&select=*");
if (!res.ok) throw new Error("Liste okunamadı: " + (await res.text()));
const items = await res.json();
console.log(`${items.length} ürün taranacak`);

let ok = 0, fail = 0;
for (const it of items) {
  const patch = { last_checked: new Date().toISOString(), last_error: null };
  try {
    let pageUrl = it.akakce_url;
    if (!pageUrl) {
      const q = it.name || nameFromUrl(it.source_url || "");
      if (!q) throw new Error("Aranacak ürün adı yok");
      const html = await get("https://www.akakce.com/arama/?q=" + encodeURIComponent(q));
      pageUrl = findProductUrl(html);
      if (!pageUrl) throw new Error("Akakçe'de eşleşme bulunamadı");
      patch.akakce_url = pageUrl;
      patch.match_confirmed = false;
      await sleep(1500);
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
    if (p.image) patch.image_url = p.image;
    // Ad linkten otomatik çıkarılmışsa (kullanıcı kendi yazmadıysa) Akakçe'deki gerçek adla değiştir.
    const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (p.title && (norm(it.name) === norm(nameFromUrl(it.source_url || "")) || it.name === "İsimsiz ürün")) {
      patch.name = p.title;
    }

    await rest("price_history", {
      method: "POST",
      body: JSON.stringify({ item_id: it.id, price: p.price, store: p.store }),
    });
    ok++;
    console.log(`✓ ${it.name}: ${p.price} TL (${p.store})`);
  } catch (e) {
    const raw = String(e.message || e);
    patch.last_error = /HTTP (403|429)/.test(raw)
      ? "Akakçe geçici olarak engelledi, sonraki taramada tekrar denenecek (son fiyat korunuyor)"
      : /timeout|aborted/i.test(raw) ? "Akakçe zamanında yanıt vermedi, sonraki taramada tekrar denenecek" : raw.slice(0, 200);
    fail++;
    console.log(`✗ ${it.name}: ${patch.last_error}`);
  }
  const save = () => rest(`items?id=eq.${it.id}`, { method: "PATCH", body: JSON.stringify(patch) });
  const OPTIONAL = ["image_url", "lowest_price", "highest_price"];
  let pr = await save();
  if (!pr.ok) {
    const msg = await pr.text();
    if (OPTIONAL.some((k) => k in patch) && /column|schema cache/i.test(msg)) {
      // Yeni sütunlar yoksa temel bilgileri yine de kaydet, sorunu açıkça söyle.
      console.log("⚠ Veritabanında yeni sütunlar eksik. supabase/schema.sql dosyasındaki v2 bölümünü SQL Editor'de çalıştır.");
      OPTIONAL.forEach((k) => delete patch[k]);
      pr = await save();
      if (!pr.ok) console.log(`✗ Kayıt yazılamadı (${it.name}): ${(await pr.text()).slice(0, 200)}`);
    } else {
      console.log(`✗ Kayıt yazılamadı (${it.name}): ${msg.slice(0, 200)}`);
    }
  } else if (patch.image_url) {
    console.log(`  görsel kaydedildi`);
  }
  await sleep(2000);
}
console.log(`Bitti: ${ok} başarılı, ${fail} hatalı`);
