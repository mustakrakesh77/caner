// Akakçe sayfalarından fiyat okuyan yardımcılar.
import { decode } from "./match.mjs";

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Ürün linkinden (Trendyol, Hepsiburada vb.) arama için ürün adı çıkarır.
export function nameFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    let slug = parts.filter((p) => p.includes("-")).sort((a, b) => b.length - a.length)[0] || parts.pop() || "";
    slug = slug.replace(/\.html?$/i, "").replace(/-p-\d+$/i, "").replace(/-(pm|p)-[a-z0-9]+$/i, "");
    slug = slug.replace(/,\d+$/, "").replace(/^en-ucuz-/, "").replace(/-fiyati$/, "");
    return decodeURIComponent(slug).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

export function findProductUrl(html) {
  const m = html.match(/href="(\/[^"]*?-fiyati,\d+\.html)"/);
  return m ? "https://www.akakce.com" + m[1] : null;
}

// Akakçe sayfaya en ucuz ~16 teklifi (kargo, stok, satıcı ile) bir "astro-island" bloğu olarak gömer; JSON-LD ise sadece 10 teklif verir.
// Astro serileştirmesi: [0, değer] = düz değer, [1, [...]] = dizi.
function unwrap(v) {
  if (Array.isArray(v) && v.length === 2 && (v[0] === 0 || v[0] === 1)) {
    if (v[0] === 1) return v[1].map(unwrap);
    const x = v[1];
    return x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, unwrap(y)])) : x;
  }
  return v;
}

function islandOffers(html, ldOffers) {
  for (const m of html.matchAll(/<astro-island[^>]*?props="([^"]*)"/g)) {
    const raw = decode(m[1]);
    if (!raw.includes("initialPgList")) continue;
    try {
      const d = JSON.parse(raw);
      const list = unwrap(d.initialPgList) || [];
      const total = unwrap(d.initialFilter)?.info?.totalPgCount ?? null;
      const offers = list
        .map((o) => {
          const price = Number(o.price);
          const store = o.pgNick && o.vdName ? `${o.vdName}/${o.pgNick}` : o.vdName || "?";
          // Doğrudan mağaza linki JSON-LD'de varsa onu, yoksa Akakçe'nin yönlendirme linkini kullan.
          const direct = ldOffers.find((x) => Math.abs(x.price - price) < 0.01 && String(x.store).toLowerCase() === store.toLowerCase());
          let url = direct?.url || null;
          if (!url && typeof o.url === "string") {
            const f = new URLSearchParams(o.url.split("?")[1] || "").get("f");
            if (f && f.startsWith("/")) url = "https://www.akakce.com" + f;
          }
          return { price, store, url, ship: o.shipPrice != null ? Number(o.shipPrice) : null, stock: o.stock != null ? Number(o.stock) : null };
        })
        .filter((o) => Number.isFinite(o.price))
        .sort((a, b) => a.price - b.price);
      if (offers.length) return { offers, total: Number.isFinite(Number(total)) ? Number(total) : null };
    } catch { /* yapı değiştiyse JSON-LD'ye düşülür */ }
  }
  return null;
}

export function parseProduct(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const b of blocks) {
    let d;
    try {
      d = JSON.parse(b[1]);
    } catch {
      continue;
    }
    const types = [].concat(d["@type"] || []);
    if (!types.some((t) => t === "Product" || t === "ProductGroup") || !d.offers) continue;
    const o = Array.isArray(d.offers) ? d.offers[0] : d.offers;
    const ld = (o.offers || [])
      .map((x) => ({ price: parseFloat(x.price), store: x.seller?.name || "?", url: x.url || null }))
      .filter((x) => Number.isFinite(x.price))
      .sort((a, b) => a.price - b.price);
    const rich = islandOffers(html, ld);
    const list = rich ? rich.offers : ld;
    const low = list[0]?.price ?? parseFloat(o.lowPrice);
    if (!Number.isFinite(low)) continue;
    const img0 = [].concat(d.image || [])[0];
    const image =
      (typeof img0 === "string" ? img0 : img0?.contentUrl || img0?.url) ||
      html.match(/property="og:image" content="([^"]+)"/)?.[1] ||
      null;
    return {
      image: /^https:\/\//.test(image || "") ? image : null,
      title: d.name || null,
      price: low,
      store: list[0]?.store || null,
      url: list[0]?.url || null,
      offers: list.slice(0, 120),
      total: rich?.total ?? (Number(o.offerCount) || null), // Akakçe'deki toplam teklif sayısı (listede gösterilenden fazla olabilir)
    };
  }
  return null;
}

const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

// Zaman aşımı + yeniden deneme: geçici hatalarda (429/5xx/ağ) 3 kereye kadar dener.
export async function get(url, tries = 3, baseDelay = 2000) {
  let lastErr;
  for (let n = 1; n <= tries; n++) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9", Accept: "text/html" },
        redirect: "follow",
        signal: AbortSignal.timeout(25000),
      });
      if (r.ok) return await r.text();
      const err = new Error(`HTTP ${r.status} ${url}`);
      err.retry = RETRY_STATUS.has(r.status);
      throw err;
    } catch (e) {
      lastErr = e;
      if (e.retry === false || n === tries) break;
      await new Promise((res) => setTimeout(res, baseDelay * n + Math.random() * 1000));
    }
  }
  throw lastErr;
}
