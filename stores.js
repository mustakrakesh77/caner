// "Büyük mağaza" listesi: satıcı adına bakar. Pazaryerlerinde (Trendyol, Hepsiburada, n11...) satıcı kısmı önemlidir:
// "Hepsiburada/Hepsiburada" ve "Trendyol/SATÜRN" büyük, "Trendyol/En Uygun Alışveriş" değil.
// Listeye yeni mağaza eklemek için BIG dizisine ad yazman yeterli (küçük harf, Türkçe karaktersiz).
(function (g) {
  const BIG = [
    "hepsiburada", "trendyol", "amazon", "n11", "mediamarkt", "media markt", "teknosa", "vatan", "vatan bilgisayar", "saturn",
    "arcelik", "beko", "vestel", "bosch", "siemens", "philips", "samsung", "lg", "apple", "xiaomi", "dyson", "tefal", "fakir",
    "arzum", "korkmaz", "karaca", "pasabahce", "english home", "madame coco", "evidea", "mudo", "tchibo", "ikea",
    "koctas", "bauhaus", "tekzen", "yatas", "bellona", "istikbal", "dogtas", "evkur", "boyner", "decathlon",
    "migros", "carrefoursa", "carrefour", "a101", "bim", "sok", "ciceksepeti", "idefix", "kitapyurdu",
  ];
  const norm = (s) =>
    String(s || "").toLocaleLowerCase("tr")
      .replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u")
      .replace(/[^a-z0-9]+/g, " ").trim();
  const RE = new RegExp("(?:^| )(?:" + BIG.join("|") + ")(?: |$)");
  function isBig(store) {
    const parts = String(store || "").split("/");
    return RE.test(norm(parts[parts.length - 1]));
  }
  g.Stores = { isBig, BIG };
  if (typeof module !== "undefined" && module.exports) module.exports = g.Stores;
})(typeof window !== "undefined" ? window : globalThis);
