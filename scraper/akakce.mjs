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
    if (d["@type"] !== "Product" || !d.offers) continue;
    const o = d.offers;
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
    return {
      title: d.name || null,
      price: low,
      store: list[0]?.store || null,
      url: list[0]?.url || null,
      offers: list.slice(0, 6),
    };
  }
  return null;
}

export async function get(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9", Accept: "text/html" },
    redirect: "follow",
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.text();
}
