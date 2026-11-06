// Mağaza uygulamalarının "paylaş" linklerini (ty.gl/xxxx gibi) çözer.
// Bu linklerin içinde ürün adı yoktur ama yönlendirme adresinin içinde ürün adı, marka ve mağaza ürün numarası bulunur.
// Mağazanın kendi sayfasını açmayız (bot koruması var); sadece yönlendirme başlığını (Location) okuruz.
import { nameFromUrl } from "./akakce.mjs";

const SHORT = /^(?:www\.)?(?:ty\.gl|app\.hb\.biz|hb\.biz|amzn\.to|amzn\.eu|a\.co|n11\.app\.link)$/i;
const EXTRA = (process.env.SHORT_HOSTS || "").split(",").map((x) => x.trim()).filter(Boolean); // yalnızca testler için
export const isShortLink = (url) => {
  try { const h = new URL(url).hostname; return SHORT.test(h) || EXTRA.includes(h); } catch { return false; }
};

const MOBILE_UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const lc = (s) => String(s || "").toLocaleLowerCase("tr");

function build(title, target) {
  let brand = "", slugName = "";
  try {
    const segs = new URL(target).pathname.split("/").filter(Boolean);
    // Trendyol: /MARKA/urun-adi-p-123456
    if (segs.length >= 2 && /-p-\d+$/i.test(segs[segs.length - 1])) brand = decodeURIComponent(segs[0]).replace(/-/g, " ");
    slugName = nameFromUrl(target);
  } catch { /* geçersiz adres */ }
  const t = String(title || "").trim();
  const name = t ? (brand && !lc(t).startsWith(lc(brand)) ? `${brand} ${t}` : t) : slugName;
  return { target, title: t, brand, name: name.trim() };
}

/** Dönüş: { name, title, brand, target } ya da çözülemezse null. fetchImpl yalnızca test içindir. */
export async function resolveShortLink(url, fetchImpl = fetch) {
  let cur = url;
  for (let hop = 0; hop < 4; hop++) {
    let r;
    try {
      r = await fetchImpl(cur, { redirect: "manual", headers: { "User-Agent": MOBILE_UA }, signal: AbortSignal.timeout(15000) });
    } catch { return null; }
    const loc = r.headers.get("location");
    if (!loc) return null;
    let next;
    try { next = new URL(loc, cur); } catch { return null; }
    const q = next.searchParams;
    const title = q.get("adj_og_title") || q.get("og_title") || "";
    const target = q.get("adjust_redirect") || q.get("redirect") || "";
    if (title || target) return build(title, target || next.href);
    if (isShortLink(next.href)) { cur = next.href; continue; }   // başka bir kısaltıcıya gittiyse devam
    return build("", next.href);                                  // gerçek mağaza adresi: açmadan adından oku
  }
  return null;
}
