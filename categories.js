// Kategori listesi ve otomatik kategori tahmini.
// Hem siteyi (tarayıcı) hem taramayı (Node) besler: tek kaynak, ikisi birbirinden ayrılmaz.
(function (g) {
  const LIST = [
    "Mutfak", "Küçük Ev Aletleri", "Beyaz Eşya", "Elektronik", "Salon", "Yemek Odası",
    "Yatak Odası", "Banyo", "Aydınlatma", "Temizlik", "Dekorasyon", "Diğer",
  ];

  // Türkçe karakterleri sadeleştirip küçük harfe çevirir: "Çöp İstasyonlu" -> "cop istasyonlu"
  const norm = (s) =>
    String(s || "").toLocaleLowerCase("tr")
      .replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u")
      .replace(/[^a-z0-9]+/g, " ").trim();

  // Sıra önemli: ilk eşleşen kazanır (ör. "dus perdesi" Salon'a değil Banyo'ya gitsin diye Banyo önde).
  // Kelimeler önek olarak eşleşir ("tencere" -> "tencere seti"); "tv" tam kelime olmalı.
  const RULES = [
    ["Küçük Ev Aletleri", "fritoz|air ?fryer|kettle|su isiticisi|blender|mikser|rondo|dograyici|mutfak robotu|tost|waffle|kahve makinesi|espresso|cay makinesi|ekmek yapma|ekmek kizartma|utu|mikrodalga|mini firin|midi firin|turbo firin|pisirici|multicooker|meyve sikacagi|sikacagi|vakumlama|sac kurutma|sac duzlestirici|epilator|tiras"],
    ["Beyaz Eşya", "buzdolabi|camasir makinesi|kurutma makinesi|bulasik makinesi|ankastre|davlumbaz|derin dondurucu|set ustu ocak|ocak|klima|firin"],
    ["Banyo", "havlu|banyo|lavabo|dus |dus$|bornoz|sabunluk|dis fircasi|klozet|tuvalet|camasir sepeti"],
    ["Aydınlatma", "avize|lamba|lambader|abajur|aplik|ampul|led serit|aydinlatma"],
    ["Temizlik", "supurge|paspas|mop|deterjan|temizlik|cop kovasi|cop torbasi|kova|firca|cam silme|buhar temizleyici"],
    ["Salon", "tv unitesi|koltuk|kanepe|berjer|sehpa|kitaplik|hali|kilim|perde|puf|konsol|vitrin|tul"],
    ["Yatak Odası", "yatak|baza|gardirop|komodin|nevresim|carsaf|yorgan|yastik|battaniye|pike|uyku"],
    ["Yemek Odası", "yemek masasi|masa|sandalye|bufe|tabure"],
    ["Elektronik", "televizyon|tv($| )|telefon|tablet|bilgisayar|laptop|notebook|monitor|kulaklik|hoparlor|soundbar|ses sistemi|modem|router|yazici|kamera|akilli saat|projeksiyon|oyun konsolu|playstation|xbox|powerbank|sarj"],
    ["Mutfak", "tencere|tava|tabak|bardak|catal|bicak|kasik|saklama|kupa|surahi|sofra|yemek takimi|cay takimi|kahvalti|tepsi|kase|termos|rende|kesme tahtasi|mutfak|cezve|demlik|cay|pisirme"],
    ["Dekorasyon", "vazo|tablo|ayna|mum|saat|cerceve|biblo|cicek|dekor|poster"],
  ].map(([cat, words]) => [cat, new RegExp("(?:^| )(?:" + words + ")")]);

  // Akakçe linkinin ilk bölümü ürün kategorisidir (ör. /fritoz/..., /robot-supurge/...); ad ile birlikte aranır.
  function guess(name, url) {
    let slug = "";
    try {
      if (/akakce\.com/i.test(url || "")) slug = new URL(url).pathname.split("/").filter(Boolean)[0] || "";
    } catch (e) { /* geçersiz link */ }
    const text = norm(slug + " " + (name || ""));
    for (const [cat, re] of RULES) if (re.test(text)) return cat;
    return null;
  }

  // "elektronik" / "ELEKTRONİK" gibi yazımları listedeki resmi ada çevirir; listede yoksa olduğu gibi bırakır.
  function canon(c) {
    if (!c) return c;
    const n = norm(c);
    if (n === "genel") return "Genel";
    return LIST.find((x) => norm(x) === n) || String(c).trim();
  }

  g.Categories = { LIST, guess, norm, canon };
  if (typeof module !== "undefined" && module.exports) module.exports = g.Categories;
})(typeof window !== "undefined" ? window : globalThis);
