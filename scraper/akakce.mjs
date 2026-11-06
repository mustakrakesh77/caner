// Akakçe sayfalarından fiyat okuyan yardımcılar.

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
    const list = (o.offers || [])
      .map((x) => ({
        price: parseFloat(x.price),
        store: x.seller?.name || "?",
        url: x.url || null,
      }))
      .filter((x) => Number.isFinite(x.price))
      .sort((a, b) => a.price - b.price);
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
      offers: list.slice(0, 6),
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
