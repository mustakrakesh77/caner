// Akakçe arama sonuçlarını okur ve kullanıcının linkindeki/adındaki ürünle eşleştirir.
// Amaç: yanlış ürünün fiyatını sessizce takip etmemek. Emin değilsek karar kullanıcıya bırakılır.
import Cat from "../categories.js";

const norm = Cat.norm;

export const decode = (s) =>
  String(s || "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));

// "7.219<i>,<!-- -->00<!-- --> TL" -> 7219
function parsePrice(chunk) {
  const text = decode(chunk.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, ""));
  const m = text.match(/(\d{1,3}(?:\.\d{3})*),(\d{2})/);
  return m ? Number(m[1].replace(/\./g, "") + "." + m[2]) : null;
}

export function parseSearch(html, base = "https://www.akakce.com") {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/<li data-pr="(\d+)"[^>]*>([\s\S]*?)<\/li>/g)) {
    const body = m[2];
    const a = body.match(/<a href="(\/[^"]*?-fiyati,\d+\.html)"[^>]*?title="([^"]*)"/);
    if (!a || seen.has(a[1])) continue;
    seen.add(a[1]);
    const img = body.match(/<img[^>]*?src="(https:\/\/[^"]+)"/);
    const price = body.match(/class="pt_v\d+">([\s\S]*?)<\/span>/);
    const more = body.match(/\+(\d+)\s*(?:<!--.*?-->)?\s*F[İI]YAT/);
    out.push({
      url: base + a[1],
      title: decode(a[2]).trim(),
      image: img ? decode(img[1]) : null,
      price: price ? parsePrice(price[1]) : null,
      offers: more ? Number(more[1]) + 1 : null,
    });
  }
  return out;
}

// Model kodu: hem harf hem rakam içeren, en az 4 karakterlik kelime ("hd9285", "kgn86aid2n").
// "HD9285/96" gibi bölünmüş yazımlar için yan yana kelimeler de birleştirilir ("hd928596").
export function codesOf(text) {
  const toks = norm(text).split(" ").filter(Boolean);
  const codes = new Set();
  toks.forEach((t, k) => {
    if (/[a-z]/.test(t) && /\d/.test(t) && t.length >= 4) {
      codes.add(t);
      const nx = toks[k + 1];
      if (nx && /^[a-z0-9]{1,3}$/.test(nx) && /\d/.test(nx)) codes.add(t + nx);
    }
  });
  return codes;
}

// 2 = birebir aynı kod, 1 = biri diğerinin başlangıcı (hd9285 ~ hd928596), 0 = uyuşmuyor
function codeStrength(userCodes, candCodes) {
  let best = 0, hit = null;
  for (const u of userCodes) {
    for (const c of candCodes) {
      const s = u === c ? 2 : Math.min(u.length, c.length) >= 5 && (u.startsWith(c) || c.startsWith(u)) ? 1 : 0;
      if (s > best) { best = s; hit = u; }
    }
  }
  return { strength: best, code: hit };
}

const STOP = new Set(["ve", "ile", "icin", "adet", "li", "lu", "lik", "tl", "en", "ucuz", "fiyati", "html", "www", "com", "https", "http"]);
const ACCESSORY = /aksesuar|yedek-parca|kilif|kapak|koruyucu|sarj|kablo|filtre|firca|torba|bez|ayak|kulp/;

function tokens(text) {
  return norm(text).split(" ").filter((t) => t.length >= 2 && !STOP.has(t));
}
const weight = (t) => (/\d/.test(t) ? 2 : 1);

// Dice benzeri skor (0-1): ortak kelimeler / iki metnin toplam kelimesi. Rakamlı kelimeler (model, kapasite) çift ağırlıklı.
export function wordScore(userText, cand) {
  const U = [...new Set(tokens(userText))];
  const slug = cand.url.split("/").filter(Boolean)[2] || "";
  const C = new Set(tokens(cand.title));
  const uw = U.reduce((s, t) => s + weight(t), 0);
  const cw = [...C].reduce((s, t) => s + weight(t), 0);
  const common = U.filter((t) => C.has(t)).reduce((s, t) => s + weight(t), 0);
  let score = uw + cw ? (2 * common) / (uw + cw) : 0;
  if (ACCESSORY.test(slug) && !ACCESSORY.test(norm(userText).replace(/ /g, "-"))) score *= 0.3;
  return score;
}

/**
 * userText: kullanıcının yazdığı ad + linkten çıkarılan ad.
 * cands: parseSearch sonucu.
 * Dönüş: { action: "use", candidate, verified, note } ya da { action: "pick", note, ranked }
 */
export function chooseMatch(userText, cands) {
  const U = codesOf(userText);
  const scored = cands.map((c) => {
    const cc = codesOf(c.title + " " + (c.url.split("/").filter(Boolean)[2] || "").replace(/-/g, " "));
    return { ...c, score: wordScore(userText, c), ...(U.size ? codeStrength(U, cc) : { strength: 0, code: null }) };
  });
  const ranked = [...scored].sort((a, b) => b.score - a.score);

  if (U.size) {
    const best = Math.max(...scored.map((c) => c.strength));
    const shown = [...U].filter((c) => c.length >= 5).slice(0, 2).join(", ").toUpperCase();
    if (best === 0) return { action: "pick", ranked, note: `Model kodu (${shown || [...U][0].toUpperCase()}) Akakçe sonuçlarında bulunamadı. Doğru ürünü sen seç.` };
    const top = scored.filter((c) => c.strength === best).sort((a, b) => b.score - a.score);
    if (top.length === 1 || top[0].score - top[1].score >= 0.1) {
      return { action: "use", candidate: top[0], ranked, verified: true, note: `Model kodu eşleşti (${top[0].code.toUpperCase()}).` };
    }
    return { action: "pick", ranked, note: "Aynı kodla birden fazla varyant (renk/model) var. Doğrusunu sen seç." };
  }

  const [a, b] = ranked;
  // Birebir aynı başlık (>=0.95) doğrudan kabul; diğerlerinde en az 0.6 ve ikinciden belirgin önde olmalı.
  if (a && (a.score >= 0.95 || (a.score >= 0.6 && (!b || a.score - b.score >= 0.03)))) {
    return { action: "use", candidate: a, ranked, verified: false, note: "Ürün adında model kodu yoktu, ad benzerliğiyle seçildi. Kontrol et." };
  }
  return { action: "pick", ranked, note: "Net bir eşleşme bulamadım. Doğru ürünü sen seç." };
}
