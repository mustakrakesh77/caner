(() => {
  const $ = (s) => document.querySelector(s);
  const cfg = window.CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    $("#setup").hidden = false;
    return;
  }
  const db = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  let items = [];
  let budget = null;
  let tab = "list";
  let openId = null;
  const F = { q: "", cat: "all", pick: "all", fresh: "all", sort: "cat" };
  let offerMode = "all"; // mağaza listesi: "all" | "big"
  try { offerMode = localStorage.getItem("offerMode") === "big" ? "big" : "all"; } catch {}
  let offersOpen = false;
  let budOpen = false; // bütçe ayrıntısı (harcanan/bekleyen + oda kartları) varsayılan kapalı
  try { budOpen = localStorage.getItem("bud") === "1"; } catch {}
  let viewMode = "grid"; // "grid" | "list"
  try { viewMode = localStorage.getItem("view") === "list" ? "list" : "grid"; } catch {}
  let hist = {};         // ürün -> son fiyatlar (kartlardaki mini eğri için)
  let scanStatus = null; // tarama durumu (settings.scan_status)
  let scanning = false, rescan = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let selMode = false;
  const sel = new Set();
  // Listeler: "ortak" = İhtiyaçlar; her kişinin kendi wishlist'i. Kişi eklemek/değiştirmek için bu satır yeterli.
  const PEOPLE = ["Sıla", "Caner"];
  const SPACES = ["ortak", ...PEOPLE];
  let space = "ortak";
  try { const sp = localStorage.getItem("space"); if (SPACES.includes(sp)) space = sp; } catch {}

  // ---------- yardımcılar ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const tl = (n) => (n == null || isNaN(n) ? "—" : Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " ₺");
  const num = (v) => (v == null || v === "" ? null : Number(v));
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "#");
  const qty = (i) => Math.max(1, Number(i.quantity) || 1);
  const unit = (i) => num(i.current_price);
  const line = (i) => (unit(i) || 0) * qty(i);
  const fmt = (d) => new Date(d).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const dropPct = (i) => {
    const c = unit(i), p = num(i.prev_price);
    return c != null && p != null && c < p ? Math.round(((p - c) / p) * 100) : 0;
  };
  const isLowest = (i) => {
    const c = unit(i), lo = num(i.lowest_price), hi = num(i.highest_price);
    return c != null && lo != null && hi != null && c <= lo && hi > c;
  };
  const hitTarget = (i) => unit(i) != null && num(i.target_price) != null && unit(i) <= num(i.target_price);
  const isDeal = (i) => dropPct(i) > 0 || hitTarget(i) || isLowest(i);
  const needsPick = (i) => !i.akakce_url && i.match_state === "pick"; // eşleşme seçimi bekliyor
  const isBig = (store) => (window.Stores ? Stores.isBig(store) : false);
  const offersOf = (i) => (Array.isArray(i.offers) ? i.offers : []).filter((o) => o && o.price != null);
  const bigBest = (i) => offersOf(i).filter((o) => isBig(o.store)).sort((a, b) => a.price - b.price)[0] || null;

  // ---------- kategoriler ----------
  const CATS = (window.Categories && Categories.LIST) || [];
  const catLabel = (c) => (!c || c === "Genel" ? "Ayrılacak" : c);
  const canon = (c) => (window.Categories ? Categories.canon(c) : c);
  const catOf = (i) => canon(i.category) || "Genel";
  const catOrder = (c) => (c === "Genel" ? 999 : CATS.includes(c) ? CATS.indexOf(c) : 500);
  const allCats = () => {
    const extra = [...new Set(items.map(catOf))].filter((c) => c !== "Genel" && !CATS.includes(c)).sort((a, b) => a.localeCompare(b, "tr"));
    return [...CATS, ...extra];
  };
  const catOptions = (selected, withAuto) =>
    (withAuto ? `<option value="Genel" ${selected === "Genel" ? "selected" : ""}>Otomatik (ben ayırırım)</option>` : "") +
    allCats().map((c) => `<option value="${esc(c)}" ${c === selected ? "selected" : ""}>${esc(c)}</option>`).join("");
  function fillCategorySelects() {
    const base = cur().filter((i) => (tab === "bought" ? i.purchased : !i.purchased));
    const counts = {};
    base.forEach((i) => { counts[catOf(i)] = (counts[catOf(i)] || 0) + 1; });
    const keys = Object.keys(counts).sort((a, b) => catOrder(a) - catOrder(b) || a.localeCompare(b, "tr"));
    if (F.cat !== "all" && !counts[F.cat]) F.cat = "all";
    $("#catSel").innerHTML = `<option value="all">Tüm kategoriler</option>` + keys.map((c) => `<option value="${esc(c)}" ${F.cat === c ? "selected" : ""}>${esc(catLabel(c))} (${counts[c]})</option>`).join("");
    const fc = $("#fCat"), chosen = fc.value || "Genel";
    fc.innerHTML = catOptions(allCats().includes(chosen) ? chosen : "Genel", true);
    $("#selList").innerHTML = `<option value="">Listeye taşı…</option><option value="__ortak">İhtiyaçlar</option>` + PEOPLE.map((p) => `<option value="${esc(p)}">${esc(p)} wishlist</option>`).join("");
    $("#selCat").innerHTML = `<option value="">Kategori değiştir…</option>` + allCats().map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  }

  const getWho = () => { try { return localStorage.getItem("who") || ""; } catch { return ""; } };
  const setWho = (v) => { try { localStorage.setItem("who", v); } catch {} };
  function renderWho() { $("#whoBtn").textContent = getWho() || "ismini yaz"; }

  // ---------- ortak onay + "yeni" rozeti ----------
  const me = () => getWho().trim();
  const lc = (x) => String(x || "").trim().toLocaleLowerCase("tr");
  const spaceOf = (i) => { const o = lc(i.owner); return PEOPLE.find((p) => lc(p) === o) || "ortak"; };
  const cur = () => items.filter((i) => spaceOf(i) === space); // bulunduğum listenin ürünleri
  const spaceLabel = (sp) => (sp === "ortak" ? "İhtiyaçlar" : `${sp} wishlist`);
  // Başlıklarda CSS büyük harfe çevirir; "wishlist" İngilizce olduğu için lang="en" ile işaretlenir (Türkçe kuralı WİSHLİST yapardı).
  const spaceLabelHtml = (sp) => (sp === "ortak" ? "İhtiyaçlar" : `${esc(sp)} <span lang="en">wishlist</span>`);
  const listOptions = (sel) =>
    `<option value="" ${!sel || sel === "ortak" ? "selected" : ""}>İhtiyaçlar</option>` +
    PEOPLE.map((p) => `<option value="${esc(p)}" ${sel === p ? "selected" : ""}>${esc(p)} wishlist</option>`).join("");
  // Son ziyaretten beri başkasının eklediği ("new") ya da değiştirdiği ("chg") ürün. İlk ziyarette hiçbir şey "yeni" sayılmaz.
  let baseline = 0;
  try { baseline = Number(localStorage.getItem("lastVisit")) || 0; localStorage.setItem("lastVisit", String(Date.now())); } catch {}
  const stamp = () => { try { localStorage.setItem("lastVisit", String(Date.now())); } catch {} };
  window.addEventListener("pagehide", stamp);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stamp();
    else { try { baseline = Number(localStorage.getItem("lastVisit")) || baseline; } catch {} }
  });
  const freshOf = (i) => {
    if (!baseline) return "";
    if (lc(i.added_by) && lc(i.added_by) !== lc(me()) && +new Date(i.created_at) > baseline) return "new";
    if (i.updated_at && lc(i.updated_by) && lc(i.updated_by) !== lc(me()) && +new Date(i.updated_at) > baseline) return "chg";
    return "";
  };

  // ---------- tema ----------
  const THEMES = [["auto", "Otomatik", "#b9b0a3"], ["krem", "Krem", "#a5573c"], ["koyu", "Koyu", "#2a2420"], ["sage", "Adaçayı", "#4d6b4f"], ["lacivert", "Lacivert", "#e0a458"]];
  const getTheme = () => { try { return localStorage.getItem("theme") || "auto"; } catch { return "auto"; } };
  function applyTheme(t) {
    const root = document.documentElement;
    if (t === "auto") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", t);
    try { localStorage.setItem("theme", t); } catch {}
    const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
    const m = document.querySelector('meta[name="theme-color"]');
    if (m && bg) m.setAttribute("content", bg);
    renderMenu();
  }
  function renderMenu() {
    const t = getTheme();
    $("#themeMenu").innerHTML = THEMES.map(([k, l, c]) => `<button type="button" data-t="${k}" class="${k === t ? "on" : ""}"><i style="background:${c}"></i>${l}</button>`).join("");
  }
  $("#themeBtn").onclick = (e) => { e.stopPropagation(); $("#themeMenu").hidden = !$("#themeMenu").hidden; };
  $("#themeMenu").onclick = (e) => {
    const b = e.target.closest("[data-t]");
    if (!b) return;
    $("#themeMenu").hidden = true;
    applyTheme(b.dataset.t);
  };
  document.addEventListener("click", (e) => { if (!e.target.closest("#themeMenu,#themeBtn")) $("#themeMenu").hidden = true; });
  applyTheme(getTheme());

  // ---------- küçük bildirim (geri al düğmeli) ----------
  let toastTimer;
  function toast(msg, label, fn) {
    $("#toastMsg").textContent = msg;
    const b = $("#toastBtn");
    b.hidden = !label; b.textContent = label || "";
    b.onclick = () => { $("#toast").hidden = true; if (fn) fn(); };
    $("#toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($("#toast").hidden = true), 6000);
  }
  $("#whoBtn").onclick = () => {
    const v = prompt("Adın ne? (ürünü kimin eklediği görünsün)", getWho());
    if (v != null) { setWho(v.trim()); renderWho(); }
  };
  if (!getWho()) setTimeout(() => $("#whoBtn").click(), 300);
  renderWho();

  function nameFromUrl(url) {
    try {
      const u = new URL(url);
      const parts = u.pathname.split("/").filter(Boolean);
      let sg = parts.filter((p) => p.includes("-")).sort((a, b) => b.length - a.length)[0] || parts.pop() || "";
      sg = sg.replace(/\.html?$/i, "").replace(/-p-\d+$/i, "").replace(/-(pm|p)-[a-z0-9]+$/i, "").replace(/,\d+$/, "").replace(/^en-ucuz-/, "").replace(/-fiyati$/, "");
      const name = decodeURIComponent(sg).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
      // "ty.gl/23xewhicl1alc" gibi kısa linklerdeki rastgele kod bir ürün adı değildir; adı tarama linkten çözer.
      if (/^(?:www\.)?(?:ty\.gl|app\.hb\.biz|hb\.biz|amzn\.to|amzn\.eu|a\.co|n11\.app\.link)$/i.test(u.hostname)) return "";
      if (!/\s/.test(name) && name.length >= 8 && /\d/.test(name)) return "";
      return name;
    } catch { return ""; }
  }

  // ---------- veri ----------
  async function load() {
    const [a, b, h] = await Promise.all([
      db.from("items").select("*").order("created_at", { ascending: false }),
      db.from("settings").select("*"),
      db.from("price_history").select("item_id,price,checked_at").order("checked_at", { ascending: false }).limit(3000),
    ]);
    if (a.error) { $("#items").innerHTML = `<div class="empty">Liste yüklenemedi: ${esc(a.error.message)}</div>`; return; }
    items = a.data;
    if (!b.error && Array.isArray(b.data)) {
      const row = b.data.find((r) => r.key === "budget");
      budget = row && row.value && row.value.amount != null ? Number(row.value.amount) : null;
      const st = b.data.find((r) => r.key === "scan_status");
      scanStatus = st && st.value ? st.value : null;
    }
    hist = {};
    if (!h.error && Array.isArray(h.data)) {
      for (const r of h.data) { const arr = (hist[r.item_id] ||= []); if (arr.length < 14) arr.push(Number(r.price)); }
      Object.values(hist).forEach((arr) => arr.reverse()); // eskiden yeniye
    }
    render();
  }
  // Gerçek zamanlı değişiklikler art arda gelir (tarama ürünleri tek tek yazar): 700 ms içindekileri tek yüklemede birleştir.
  let loadTimer;
  const queueLoad = () => { clearTimeout(loadTimer); loadTimer = setTimeout(() => { if (!openId) load(); }, 700); };

  const stampPatch = (patch) => ({ ...patch, updated_at: new Date().toISOString(), updated_by: me() || null });
  async function upd(id, patch) {
    const { error } = await db.from("items").update(stampPatch(patch)).eq("id", id);
    if (error) alert("Kaydedilemedi: " + error.message + (/column|schema/i.test(error.message) ? "\n\nSupabase'de yeni sütunlar eksik olabilir (supabase/schema.sql v2 bölümü)." : ""));
    await load();
    return !error;
  }

  // ---------- bütçe (tek satır; ayrıntı ve oda kartları "Ayrıntı"nın altında) ----------
  function renderBudget() {
    const box = $("#budget");
    if (space !== "ortak") {
      // Wishlist: bütçe yok; kişinin kaç isteği var, toplamı ne kadar, kaçı alınmış.
      const mine = cur(), want = mine.filter((i) => !i.purchased), got = mine.filter((i) => i.purchased);
      box.innerHTML = `<div class="bud-line"><span class="bl">${spaceLabelHtml(space)}</span><b class="wtot">${tl(want.reduce((t, i) => t + line(i), 0))}</b>
        <span class="bsub">${want.length} istek${got.length ? ` · ${got.length} alınan (${tl(got.reduce((t, i) => t + line(i), 0))})` : ""}</span></div>`;
      return;
    }
    const open = cur().filter((i) => !i.purchased), done = cur().filter((i) => i.purchased);
    const spent = done.reduce((t, i) => t + line(i), 0);
    const pend = open.reduce((t, i) => t + line(i), 0);
    const has = budget != null && budget > 0;
    const left = has ? budget - spent - pend : 0;
    let html = `<div class="bud-line"><span class="bl">${has ? (left < 0 ? "Aşım" : "Kalan") : "Bütçe"}</span><b class="wtot ${has && left < 0 ? "neg" : ""}">${has ? tl(Math.abs(left)) : tl(spent + pend)}</b>
      <button id="budEdit" type="button">${has ? tl(budget) : "Bütçe belirle"} <small>düzenle</small></button></div>`;
    if (has) {
      const sp = Math.min(100, (spent / budget) * 100);
      const pp = Math.min(100 - sp, (pend / budget) * 100);
      html += `<div class="bar ${left < 0 ? "over" : ""}" role="img" aria-label="Harcanan ve bekleyen toplam"><i class="spent" style="width:${sp}%"></i><i class="pend" style="width:${pp}%"></i></div>`;
    }
    // Oda kartları: her kategori için kaç ürün alındı, ne kadar tutuyor. Karta dokununca o kategoriye süzülür.
    const rooms = {};
    cur().forEach((i) => {
      const r = (rooms[catOf(i)] ||= { n: 0, done: 0, spent: 0, plan: 0 });
      r.n++;
      if (i.purchased) { r.done++; r.spent += line(i); } else r.plan += line(i);
    });
    const keys = Object.keys(rooms).sort((x, y) => catOrder(x) - catOrder(y) || x.localeCompare(y, "tr"));
    const nums = `<div class="bud-nums"><span>Harcanan <b>${tl(spent)}</b></span><span>Bekleyen <b>${tl(pend)}</b></span>${has ? `<span class="${left < 0 ? "neg" : ""}">${left < 0 ? "Aşım" : "Kalan"} <b>${tl(Math.abs(left))}</b></span>` : ""}</div>`;
    const roomHtml = keys.length ? `<div class="rooms">${keys.map((c) => {
      const r = rooms[c], pct = r.n ? Math.round((r.done / r.n) * 100) : 0;
      return `<button type="button" class="room ${F.cat === c ? "on" : ""}" data-room="${esc(c)}" aria-label="${esc(catLabel(c))}: ${r.n} üründen ${r.done} alındı">
        <span class="rname">${esc(catLabel(c))}</span><span class="rcount">${r.done}<small>/${r.n}</small></span>
        <span class="rbar"><i style="width:${pct}%"></i></span><span class="rmoney">${tl(r.spent + r.plan)}</span></button>`;
    }).join("")}</div>` : "";
    html += `<details class="budmore" ${budOpen ? "open" : ""}><summary>Ayrıntı ve odalar <small>${keys.length}</small></summary>${nums}${roomHtml}</details>`;
    box.innerHTML = html;
  }
  $("#budget").addEventListener("toggle", (e) => { // "toggle" kabarcıklanmaz: yakalama aşamasında dinle
    if (e.target.classList && e.target.classList.contains("budmore")) { budOpen = e.target.open; try { localStorage.setItem("bud", budOpen ? "1" : "0"); } catch {} }
  }, true);
  $("#budget").onclick = async (e) => {
    const rm = e.target.closest(".room");
    if (rm) {
      const c = rm.dataset.room;
      if (F.cat === c) F.cat = "all";
      else {
        F.cat = c;
        const hasOpen = cur().some((i) => !i.purchased && catOf(i) === c);
        if (!hasOpen && cur().some((i) => i.purchased && catOf(i) === c)) setTab("bought"); // hepsi alınmışsa Alınanlar'a geç
      }
      render();
      return;
    }
    if (!e.target.closest("#budEdit")) return;
    const v = prompt("Toplam bütçen kaç ₺? (boş bırakırsan bütçeyi kaldırır)", budget != null ? String(budget) : "");
    if (v === null) return;
    const n = v.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".");
    const amount = n === "" ? null : Number(n);
    const { error } = await db.from("settings").upsert({ key: "budget", value: { amount } });
    if (error) return alert("Bütçe kaydedilemedi: " + error.message + "\n\nSupabase'de 'settings' tablosu eksik olabilir (supabase/schema.sql v2 bölümünü çalıştır).");
    load();
  };

  // ---------- filtre çubuğu ----------
  function renderChips() {
    const chip = (kind, val, label) => `<button type="button" class="chip ${F[kind] === val ? "on" : ""}" data-kind="${kind}" data-val="${esc(val)}">${label}</button>`;
    const open0 = cur().filter((i) => !i.purchased);
    const nPick = open0.filter(needsPick).length, nFresh = open0.filter((i) => freshOf(i)).length;
    if (F.pick === "1" && !nPick) F.pick = "all";
    if (F.fresh === "1" && !nFresh) F.fresh = "all";
    // Sadece işe yarayanlar görünür: eşleşme bekleyenler, yeni gelenler. Hiçbiri yoksa satır hiç görünmez.
    const parts = [];
    if (nPick) parts.push(chip("pick", "1", `Eşleşme seç (${nPick})`));
    if (nFresh) parts.push(chip("fresh", "1", `Yeni (${nFresh})`));
    $("#chips").innerHTML = parts.join(`<span class="sep"></span>`);
    fillCategorySelects();
  }
  $("#chips").onclick = (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    const k = b.dataset.kind;
    F[k] = ["pick", "fresh"].includes(k) && F[k] === b.dataset.val ? "all" : b.dataset.val; // bu çipler aç/kapa
    render();
  };
  $("#q").oninput = (e) => { F.q = e.target.value; render(); };
  $("#sort").onchange = (e) => { F.sort = e.target.value; render(); };
  $("#catSel").onchange = (e) => { F.cat = e.target.value; render(); };
  $("#filterBtn").onclick = () => $("#filterDlg").showModal();
  $("#filterReset").onclick = () => { F.cat = "all"; F.sort = "cat"; $("#sort").value = "cat"; render(); };
  $("#viewBtn").onclick = () => { viewMode = viewMode === "list" ? "grid" : "list"; try { localStorage.setItem("view", viewMode); } catch {} render(); };

  // ---------- galeri ----------
  function visible() {
    let list = cur().filter((i) => (tab === "bought" ? i.purchased : !i.purchased));
    if (tab === "deals") list = list.filter(isDeal);
    const q = F.q.trim().toLocaleLowerCase("tr");
    if (q) list = list.filter((i) => [i.name, i.category, i.note].join(" ").toLocaleLowerCase("tr").includes(q));
    if (F.cat !== "all") list = list.filter((i) => catOf(i) === F.cat);
    if (F.pick === "1") list = list.filter(needsPick);
    if (F.fresh === "1") list = list.filter((i) => freshOf(i));
    const byPrice = (a, b) => (unit(a) ?? Infinity) - (unit(b) ?? Infinity);
    if (F.sort === "price-asc") list = [...list].sort(byPrice);
    else if (F.sort === "price-desc") list = [...list].sort((a, b) => (unit(b) ?? -1) - (unit(a) ?? -1));
    else if (F.sort === "drop") list = [...list].sort((a, b) => dropPct(b) - dropPct(a));
    return list;
  }

  // Kartta en önemli 2 rozet görünür (kalabalık olmasın); detayda hepsi.
  function overlayBadges(i, max = 2) {
    const fr = freshOf(i), d = dropPct(i), list = [];
    if (needsPick(i)) list.push(`<span class="badge b-pick">Aday seç</span>`);
    if (fr) list.push(`<span class="badge b-new">${fr === "new" ? "Yeni" : "Güncellendi"}</span>`);
    if (d) list.push(`<span class="badge b-down">↓ %${d}</span>`);
    else if (unit(i) != null && num(i.prev_price) != null && unit(i) > num(i.prev_price)) list.push(`<span class="badge b-up">↑ %${Math.round(((unit(i) - num(i.prev_price)) / num(i.prev_price)) * 100)}</span>`);
    if (isLowest(i)) list.push(`<span class="badge b-low">En düşük</span>`);
    if (hitTarget(i)) list.push(`<span class="badge b-hit">Hedefte</span>`);
    return list.slice(0, max).join("");
  }
  const mono = (i) => (String(i.name || "?").trim().charAt(0) || "?").toLocaleUpperCase("tr");
  const imgTag = (i) => i.image_url && /^https:\/\//.test(i.image_url)
    ? `<img src="${esc(i.image_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : "";

  // Kartlardaki mini fiyat eğrisi: son taramalardaki fiyatlar (en az 3 nokta ve gerçek bir değişim varsa).
  function spark(i) {
    const h = hist[i.id];
    if (!h || h.length < 3) return "";
    const lo = Math.min(...h), hi = Math.max(...h);
    if (hi - lo < 0.5) return "";
    const W = 46, H = 16;
    const pts = h.map((v, k) => `${((k / (h.length - 1)) * W).toFixed(1)},${(H - 2 - ((v - lo) / (hi - lo)) * (H - 4)).toFixed(1)}`).join(" ");
    const dir = h[h.length - 1] < h[0] ? "down" : h[h.length - 1] > h[0] ? "up" : "flat";
    return `<svg class="spark ${dir}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Fiyat eğilimi"><title>Son ${h.length} taramada ${tl(h[0])} → ${tl(h[h.length - 1])}</title><polyline points="${pts}"/></svg>`;
  }

  function gcard(i) {
    const c = unit(i), p = num(i.prev_price), q = qty(i);
    const pending = !i.purchased && c == null && !needsPick(i) && !i.last_error; // eklendi, fiyatı henüz aranıyor
    const cands = Array.isArray(i.candidates) ? i.candidates : [];
    // Eşleşme seçimi bekleyen ürün: adaylar kartın üzerinde, tek dokunuşla seçilir.
    const quick = needsPick(i) && cands.length
      ? `<div class="qlabel">Hangisi? Dokun, seç</div><div class="qpick">${cands.slice(0, 3).map((c, k) => `<button type="button" class="qp" data-id="${i.id}" data-idx="${k}" title="${esc(c.title)}"><span class="qt">${esc(c.title)}</span>${c.price != null ? `<b>${tl(c.price)}</b>` : ""}</button>`).join("")}</div>` : "";
    // Etiketler sadece gerektiğinde: uyuşmazlık uyarısı, "kim alacak", not.
    const tags = [
      i.match_warn ? `<span class="tag chk">Uyuşmuyor?</span>` : "",
      i.note ? `<span class="tag" title="${esc(i.note)}">Not</span>` : "",
    ].filter(Boolean).join("");
    return `<article class="gcard ${i.purchased ? "done" : ""} ${selMode ? "selectable" : ""} ${sel.has(i.id) ? "picked" : ""}" data-id="${i.id}" tabindex="0">
      <div class="swipehint" aria-hidden="true"></div>
      <div class="imgwrap"><span class="ph">${esc(mono(i))}</span>${imgTag(i)}<span class="pick" aria-hidden="true">✓</span>
        <div class="ov">${overlayBadges(i)}</div>
        <button type="button" class="quick" data-act="${i.purchased ? "undo" : "buy"}" data-id="${i.id}" aria-label="${i.purchased ? "Geri al" : "Aldık olarak işaretle"}">${i.purchased ? "↩" : "✓"}</button>
      </div>
      <div class="gbody">
        <div class="gname">${esc(i.name)}</div>
        <div class="inl">${overlayBadges(i)}</div>
        ${quick}
        ${pending
          ? `<div class="gprice pend"><i></i><span>Fiyat aranıyor…</span></div>`
          : `<div class="gprice" ${quick ? "hidden" : ""}><b>${needsPick(i) ? "Eşleşme seç" : c != null ? tl(c) : "—"}</b>${p != null && c != null && c < p ? `<s>${tl(p)}</s>` : ""}${q > 1 ? `<em>× ${q}</em>` : ""}${spark(i)}</div>
        <div class="gstore" ${quick ? "hidden" : ""}>${needsPick(i) ? "doğru ürünü seç" : c != null ? esc(i.best_store || "") : i.last_error ? "fiyat alınamadı, tekrar denenecek" : ""}</div>`}
        ${tags ? `<div class="tags">${tags}</div>` : ""}
      </div>
    </article>`;
  }

  // Fırsat şeridi: indirimdeki / hedefe inen / en düşük fiyatlı ürünler, yatay kayar.
  function renderDeals() {
    const el = $("#dealstrip");
    const deals = cur().filter((i) => !i.purchased && isDeal(i)).sort((a, b) => dropPct(b) - dropPct(a) || (unit(a) ?? 0) - (unit(b) ?? 0)).slice(0, 12);
    el.hidden = !deals.length;
    if (!deals.length) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="strip-title">Fırsatlar <small>${deals.length}</small></div><div class="strip">${deals.map((i) => {
      const d = dropPct(i);
      const tag = d ? `↓ %${d}` : isLowest(i) ? "En düşük" : "Hedefte";
      return `<button type="button" class="dcard" data-id="${i.id}"><span class="dthumb"><b>${esc(mono(i))}</b>${imgTag(i)}</span>
        <span class="dtxt"><span class="dname">${esc(i.name)}</span><span class="dprice">${tl(unit(i))}<em>${tag}</em></span></span></button>`;
    }).join("")}</div>`;
  }
  $("#dealstrip").onclick = (e) => { const b = e.target.closest(".dcard"); if (b) openDetail(b.dataset.id); };

  function renderSpaces() {
    $("#spaces").innerHTML = SPACES.map((sp) => {
      const n = items.filter((i) => spaceOf(i) === sp && !i.purchased).length;
      const l1 = sp === "ortak" ? "İhtiyaçlar" : sp;
      const l2 = sp === "ortak" ? `${n} ürün` : `<span lang="en">wishlist</span> ${n}`;
      return `<button type="button" data-space="${esc(sp)}" class="${sp === space ? "on" : ""}" aria-label="${esc(spaceLabel(sp))}, ${n} ürün"><span class="n1">${esc(l1)}</span><span class="n2">${l2}</span></button>`;
    }).join("");
  }
  $("#spaces").onclick = (e) => {
    const b = e.target.closest("[data-space]");
    if (!b || b.dataset.space === space) return;
    space = b.dataset.space;
    try { localStorage.setItem("space", space); } catch {}
    // Başka listeye geçince filtreler, arama ve seçim sıfırlanır
    Object.assign(F, { q: "", cat: "all", pick: "all", fresh: "all" });
    $("#q").value = "";
    if (selMode) setSelMode(false);
    tab = "list";
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x.dataset.tab === "list"));
    render();
  };

  function render() {
    renderSpaces();
    renderBudget();
    renderChips();
    renderDeals();
    const open = cur().filter((i) => !i.purchased);
    $("#cList").textContent = open.length;
    $("#cDeals").textContent = open.filter(isDeal).length;
    $("#cBought").textContent = cur().filter((i) => i.purchased).length;
    const last = (scanStatus && scanStatus.finished_at) || items.map((i) => i.last_checked).filter(Boolean).sort().pop();
    const shortWhen = (d) => { const t = new Date(d), n = new Date(); return t.toDateString() === n.toDateString() ? t.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : t.toLocaleDateString("tr-TR", { day: "numeric", month: "short" }); };
    const hrs = last ? (Date.now() - new Date(last).getTime()) / 3600000 : 0;
    const stale = $("#stale");
    stale.hidden = !(open.length && last && hrs > 5);
    if (!stale.hidden) stale.textContent = `Son tarama ${Math.floor(hrs)} saat önce yapıldı, otomatik tarama gecikmiş olabilir. "Fiyatları yenile"ye basabilirsin.`;

    const list = visible();
    const total = list.reduce((s, i) => s + line(i), 0);
    $("#summary").textContent = list.length ? `${list.length} ürün · ${tab === "bought" ? "harcanan" : "toplam"} ${tl(total)}${list.some((i) => qty(i) > 1) ? " (adetler dahil)" : ""} · ${last ? "tarandı " + shortWhen(last) : "henüz taranmadı"}` : "";
    $("#items").classList.toggle("listview", viewMode === "list");
    $("#viewBtn").textContent = viewMode === "list" ? "▦" : "☰"; $("#viewBtn").title = $("#viewBtn").ariaLabel = viewMode === "list" ? "Izgara görünümüne geç" : "Liste görünümüne geç";
    const nf = (F.cat !== "all" ? 1 : 0) + (F.sort !== "cat" ? 1 : 0);
    $("#filterCount").hidden = !nf; $("#filterCount").textContent = nf;
    $("#filterBtn").classList.toggle("on", nf > 0);

    if (!list.length) {
      const filtered = F.q || F.cat !== "all" || F.pick !== "all" || F.fresh !== "all";
      $("#items").innerHTML = `<div class="empty">${filtered ? "Filtreye uyan ürün yok." : tab === "list" ? (space === "ortak" ? "Liste boş. Sağ alttaki + ile ilk ürünü ekle." : "Wishlist boş. Sağ alttaki + ile ilk isteği ekle.") : tab === "deals" ? "Şu an indirimde ürün yok." : "Henüz bir şey almadınız."}</div>`;
    } else if (F.sort === "cat") {
      const groups = {};
      list.forEach((i) => (groups[catOf(i)] ||= []).push(i));
      $("#items").innerHTML = Object.keys(groups).sort((a, b) => catOrder(a) - catOrder(b) || a.localeCompare(b, "tr")).map((c) => `<div class="cat">${esc(catLabel(c))}</div><div class="grid">${groups[c].map(gcard).join("")}</div>`).join("");
    } else {
      $("#items").innerHTML = `<div class="grid">${list.map(gcard).join("")}</div>`;
    }
    if (selMode) {
      const vis = new Set(list.map((i) => i.id));
      [...sel].forEach((id) => { if (!vis.has(id)) sel.delete(id); });
      renderSelBar();
    }
  }

  function setTab(t) {
    tab = t;
    sel.clear();
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x.dataset.tab === t));
    render();
  }
  document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));

  let suppressClick = false; // kaydırma hareketinden sonra kartın açılmasını engeller
  $("#items").onclick = async (e) => {
    if (suppressClick) return;
    const qp = e.target.closest(".qp");
    if (qp && !selMode) { e.stopPropagation(); return pickCandidate(qp.dataset.id, Number(qp.dataset.idx)); }
    const card0 = e.target.closest(".gcard");
    if (selMode) {
      if (!card0) return;
      const id = card0.dataset.id;
      sel.has(id) ? sel.delete(id) : sel.add(id);
      card0.classList.toggle("picked", sel.has(id));
      renderSelBar();
      return;
    }
    const q = e.target.closest(".quick");
    if (q) {
      e.stopPropagation();
      const id = q.dataset.id;
      return setBought(id, q.dataset.act === "buy");
    }
    const card = e.target.closest(".gcard");
    if (card) openDetail(card.dataset.id);
  };
  // Aday seçimi (kartta ya da detayda). Akakçe aramasındaki fiyat hemen gösterilir; tam mağaza listesi taramada gelir.
  async function pickCandidate(id, idx) {
    const it = items.find((x) => x.id === id);
    const c = it && (it.candidates || [])[idx];
    if (!c) return false;
    const patch = { akakce_url: c.url, match_confirmed: true, match_state: "confirmed", match_note: null, match_warn: null, last_error: null,
      current_price: typeof c.price === "number" ? c.price : null, prev_price: null, lowest_price: null, highest_price: null, offers: [], offers_total: null, image_url: c.image || null };
    if (!it.name || it.name === nameFromUrl(it.source_url || "") || it.name === "İsimsiz ürün") patch.name = c.title; // adı kullanıcı yazmadıysa gerçek ürün adını al
    const ok = await upd(id, patch);
    if (ok) scheduleScan("Seçildi. Mağaza fiyatları birazdan gelir.", 1500);
    return ok;
  }
  async function requestResearch(id) {
    if (!confirm("Akakçe'de yeniden aranacak. Yeni bir ürün seçene kadar fiyat güncellenmez. Devam edilsin mi?")) return;
    const ok = await upd(id, { match_state: "pick", akakce_url: null, match_confirmed: false, candidates: [], match_note: null, match_warn: null });
    if (openId) detailDlg.close();
    if (ok) scheduleScan("Adaylar aranıyor, birazdan gelir.", 1500);
  }

  // "Aldık" / "Geri al": yanlışlıkla basılırsa 6 saniye boyunca geri alınabilir.
  async function setBought(id, bought) {
    const it = items.find((x) => x.id === id);
    const ok = await upd(id, bought ? { purchased: true, purchased_at: new Date().toISOString() } : { purchased: false, purchased_at: null });
    if (ok && it) toast(`${String(it.name).slice(0, 40)} ${bought ? "alındı olarak işaretlendi" : "listeye geri döndü"}`, "Geri al", () => setBought(id, !bought));
  }

  // ---------- kaydırarak işlem: sağa = Aldık / Geri al, sola = Sil (telefon/kalem; fare ile değil) ----------
  let sw = null;
  $("#items").addEventListener("pointerdown", (e) => {
    if (selMode || e.pointerType === "mouse") return;
    const card = e.target.closest(".gcard");
    if (!card || e.target.closest(".quick") || e.target.closest(".qp")) return;
    sw = { card, id: card.dataset.id, x0: e.clientX, y0: e.clientY, dx: 0, active: false, pid: e.pointerId };
  });
  $("#items").addEventListener("pointermove", (e) => {
    if (!sw || e.pointerId !== sw.pid) return;
    const dx = e.clientX - sw.x0, dy = e.clientY - sw.y0;
    if (!sw.active) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { sw = null; return; } // dikey: sayfa kaydırılıyor
      if (Math.abs(dx) < 12) return;
      sw.active = true;
      sw.card.classList.add("swiping");
      try { sw.card.setPointerCapture(e.pointerId); } catch {}
    }
    sw.dx = dx;
    sw.card.style.transform = `translateX(${dx}px) rotate(${dx / 50}deg)`;
    const h = sw.card.querySelector(".swipehint");
    h.className = "swipehint " + (dx > 0 ? "buy" : "del");
    h.textContent = dx > 0 ? (tab === "bought" ? "↩ Geri al" : "✓ Aldık") : "Sil";
    h.style.opacity = Math.min(1, Math.abs(dx) / 110);
  });
  const resetSwipe = (s) => {
    s.card.classList.remove("swiping");
    s.card.style.transform = "";
    const h = s.card.querySelector(".swipehint");
    if (h) h.style.opacity = 0;
  };
  $("#items").addEventListener("pointerup", async (e) => {
    if (!sw || e.pointerId !== sw.pid) return;
    const s = sw; sw = null;
    if (!s.active) return;
    suppressClick = true; setTimeout(() => (suppressClick = false), 60);
    resetSwipe(s);
    if (Math.abs(s.dx) < 110) return;
    if (s.dx > 0) return setBought(s.id, tab !== "bought");
    const it = items.find((x) => x.id === s.id);
    if (!confirm(`"${String((it && it.name) || "Ürün").slice(0, 60)}" listeden silinsin mi? Bu geri alınamaz.`)) return;
    const { error } = await db.from("items").delete().eq("id", s.id);
    if (error) alert("Silinemedi: " + error.message);
    await load();
  });
  $("#items").addEventListener("pointercancel", () => { if (sw) { if (sw.active) resetSwipe(sw); sw = null; } });

  $("#items").onkeydown = (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("gcard")) { e.preventDefault(); e.target.click(); }
  };

  // ---------- toplu seçim: seçip kaldır / aldık / kategori değiştir ----------
  function setSelMode(on) {
    selMode = on;
    sel.clear();
    document.body.classList.toggle("selmode", on);
    $("#selbar").hidden = !on;
    $("#selBtn").textContent = on ? "Vazgeç" : "Seç";
    render();
  }
  function renderSelBar() {
    $("#selCount").textContent = `${sel.size} seçili`;
    const none = sel.size === 0;
    ["#selBuy", "#selDel", "#selCat", "#selList"].forEach((s) => ($(s).disabled = none));
    $("#selBuy").textContent = tab === "bought" ? "Geri al" : "Aldık";
  }
  async function bulk(patch) {
    const { error } = await db.from("items").update(stampPatch(patch)).in("id", [...sel]);
    if (error) alert("Kaydedilemedi: " + error.message);
    return !error;
  }
  $("#selBtn").onclick = () => setSelMode(!selMode);
  $("#selX").onclick = () => setSelMode(false);
  $("#selAll").onclick = () => { visible().forEach((i) => sel.add(i.id)); render(); };
  $("#selBuy").onclick = async () => {
    const ok = await bulk(tab === "bought" ? { purchased: false, purchased_at: null } : { purchased: true, purchased_at: new Date().toISOString() });
    if (ok) { await load(); setSelMode(false); }
  };
  $("#selCat").onchange = async (e) => {
    const v = e.target.value;
    if (!v) return;
    if (await bulk({ category: v })) { await load(); setSelMode(false); } else e.target.value = "";
  };
  $("#selList").onchange = async (e) => {
    const v = e.target.value;
    if (!v) return;
    const n = sel.size, label = v === "__ortak" ? "İhtiyaçlar" : `${v} wishlist`;
    if (await bulk({ owner: v === "__ortak" ? null : v })) { await load(); setSelMode(false); toast(`${n} ürün ${label} listesine taşındı`); } else e.target.value = "";
  };
  $("#selDel").onclick = async () => {
    const ids = [...sel];
    if (!ids.length) return;
    const names = ids.slice(0, 3).map((id) => (items.find((i) => i.id === id) || {}).name).filter(Boolean).map((n) => "• " + n.slice(0, 50)).join("\n");
    if (!confirm(`${ids.length} ürün listeden silinsin mi? Bu geri alınamaz.\n\n${names}${ids.length > 3 ? "\n…" : ""}`)) return;
    const { error } = await db.from("items").delete().in("id", ids);
    if (error) return alert("Silinemedi: " + error.message);
    await load();
    setSelMode(false);
  };

  // ---------- ürün ekleme ----------
  const addDlg = $("#addDlg"), detailDlg = $("#detailDlg");
  const filterDlg = $("#filterDlg");
  // Panodaki link: izin zaten verilmişse açılışta kendiliğinden doldurulur; yoksa "Yapıştır" düğmesi (dokunuşla) okur.
  async function tryClipboard(auto) {
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) return "";
      if (auto) {
        if (!navigator.permissions) return "";
        const st = await navigator.permissions.query({ name: "clipboard-read" });
        if (st.state !== "granted") return "";
      }
      const m = String((await navigator.clipboard.readText()) || "").match(/https?:\/\/[^\s]+/i);
      return m ? m[0] : "";
    } catch { return ""; }
  }
  async function openAdd(prefill) {
    $("#fList").innerHTML = listOptions(space);
    renderChips();
    addDlg.showModal();
    $("#fUrl").focus();
    const url = prefill || (await tryClipboard(true));
    if (url && !$("#fUrl").value) $("#fUrl").value = url;
  }
  $("#fab").onclick = () => openAdd();
  $("#pasteBtn").onclick = async () => {
    const u = await tryClipboard(false);
    if (u) $("#fUrl").value = u; else toast("Panoda link bulamadım. Linki kopyalayıp tekrar dene.");
  };
  [addDlg, detailDlg, filterDlg].forEach((d) => d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-close]")) d.close(); }));
  detailDlg.addEventListener("close", () => { openId = null; });

  $("#addForm").onsubmit = async (e) => {
    e.preventDefault();
    const url = $("#fUrl").value.trim();
    const isAk = /akakce\.com/i.test(url);
    const name = $("#fName").value.trim() || nameFromUrl(url) || "İsimsiz ürün";
    let cat = $("#fCat").value || "Genel";
    if (cat === "Genel") cat = (window.Categories && Categories.guess(name, url)) || "Genel"; // Otomatik: hemen ayır, ilk taramada Akakçe'ye göre kesinleşir
    const row = {
      name,
      source_url: url,
      akakce_url: isAk ? url : null,
      match_confirmed: isAk,
      match_state: isAk ? "confirmed" : null,
      category: cat,
      quantity: Math.max(1, Number($("#fQty").value) || 1),
      target_price: $("#fTarget").value ? Number($("#fTarget").value) : null,
      note: $("#fNote").value.trim() || null,
      added_by: getWho() || null,
      owner: $("#fList").value || null,
      updated_by: me() || null,
    };
    const { error } = await db.from("items").insert(row);
    if (error) return alert("Eklenemedi: " + error.message + (/column|schema/i.test(error.message) ? "\n\nSupabase'de yeni sütunlar eksik (supabase/schema.sql v2 bölümü)." : ""));
    e.target.reset();
    $("#fQty").value = 1;
    addDlg.close();
    await load();
    scheduleScan("Eklendi. Ürünün adı ve fiyatı birazdan gelir.", 8000);
  };

  // ---------- ürün detayı ----------
  // Mağaza listesi: Akakçe sayfaya en ucuz ~16 teklifi verir (toplam sayı ayrıca belirtilir); "Büyük mağazalar" süzgeci.
  function offersBlock(i) {
    const all = offersOf(i).sort((a, b) => a.price - b.price);
    if (!all.length) return "";
    const big = all.filter((o) => isBig(o.store));
    const list = offerMode === "big" ? big : all;
    const shown = offersOpen ? list : list.slice(0, 8);
    const total = num(i.offers_total);
    const cb = big[0];
    const row = (o) => {
      const label = esc(String(o.store).replace("/", " · "));
      return `<li><span class="of-store">${o.url ? `<a href="${esc(safeUrl(o.url))}" target="_blank" rel="noopener">${label}</a>` : label}${offerMode !== "big" && isBig(o.store) ? ` <i class="bigmark">büyük</i>` : ""}</span>
        <span class="of-price"><b>${tl(o.price)}</b>${o.ship > 0 ? `<small>+${tl(o.ship)} kargo</small>` : ""}</span></li>`;
    };
    return `<div class="sec">Mağazalar</div>
      <div class="hint" style="padding:0">${all.length} teklif listeleniyor${total && total > all.length ? ` · Akakçe'de toplam ${total} (en ucuz ${all.length}'sı burada)` : ""}</div>
      ${cb ? `<div class="hint" style="padding:0">Büyük mağazada en ucuz: <b>${tl(cb.price)}</b> (${esc(String(cb.store).replace("/", " · "))})${cb.price > all[0].price + 0.5 ? ` · genel en ucuzdan ${tl(cb.price - all[0].price)} fazla` : ""}</div>` : `<div class="hint" style="padding:0">Listede büyük mağaza yok.</div>`}
      <div class="seg"><button type="button" data-act="offers-all" class="${offerMode === "all" ? "on" : ""}">Tümü (${all.length})</button><button type="button" data-act="offers-big" class="${offerMode === "big" ? "on" : ""}">Büyük mağazalar (${big.length})</button></div>
      ${list.length ? `<ul class="offers">${shown.map(row).join("")}</ul>` : `<div class="hint">Bu süzgeçle teklif yok. "Tümü"ne bak.</div>`}
      ${list.length > 8 ? `<button type="button" class="linkbtn2" data-act="offers-more">${offersOpen ? "Daha az göster" : `Tümünü göster (${list.length})`}</button>` : ""}
      ${total && total > all.length && i.akakce_url ? `<a class="hint" href="${esc(safeUrl(i.akakce_url))}" target="_blank" rel="noopener">Akakçe'de tüm ${total} teklifi gör →</a>` : ""}`;
  }
  const refreshOffers = () => {
    const i = items.find((x) => x.id === openId);
    if (i && $("#offersBox")) $("#offersBox").innerHTML = offersBlock(i);
  };

  // Aday ürünler: eşleşme belirsizse ya da kullanıcı başka ürün isterse.
  function candBlock(i) {
    const cands = Array.isArray(i.candidates) ? i.candidates : [];
    if (!cands.length) return needsPick(i) ? `<div class="warn">Adaylar sonraki taramada gelecek. Hemen görmek için üstteki "Fiyatları yenile"ye bas.</div>` : "";
    const urgent = needsPick(i) || (i.akakce_url && !i.match_confirmed);
    const rows = cands.map((c, k) => {
      const isCur = c.url === i.akakce_url;
      const img = c.image && /^https:\/\//.test(c.image) ? `<img src="${esc(c.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : "";
      return `<li class="cand ${isCur ? "cur" : ""}"><span class="cthumb">${img}</span>
        <span class="cinfo"><b>${esc(c.title)}</b><small>${c.price != null ? `en ucuz ${tl(c.price)}` : ""}${c.offers ? ` · ${c.offers} teklif` : ""} · <a href="${esc(safeUrl(c.url))}" target="_blank" rel="noopener">Akakçe'de bak</a></small></span>
        ${isCur ? `<span class="curmark">Seçili</span>` : `<button type="button" class="btn" data-act="pickc" data-idx="${k}">Bunu seç</button>`}</li>`;
    }).join("");
    return `<details class="cands" ${urgent ? "open" : ""}><summary>${urgent ? "Doğru ürünü seç" : "Başka ürün mü? Adaylara bak"} (${cands.length})</summary>
      ${i.match_note ? `<div class="hint">${esc(i.match_note)}</div>` : ""}<ul class="candlist">${rows}</ul>${urgent ? `<button type="button" class="linkbtn2" data-act="fix">Listede yok, Akakçe linkini yapıştıracağım</button>` : ""}</details>`;
  }

  function openDetail(id) {
    const i = items.find((x) => x.id === id);
    if (!i) return;
    openId = id;
    offersOpen = false;
    const c = unit(i), p = num(i.prev_price), q = qty(i);
    const warn = i.akakce_url && !i.match_confirmed && !i.purchased
      ? `<div class="warn">${esc(i.match_note || "Bu eşleşme doğru mu?")} <a href="${esc(safeUrl(i.akakce_url))}" target="_blank" rel="noopener">Akakçe sayfasına bak</a>
         <button type="button" class="btn" data-act="ok">Doğru</button><button type="button" class="btn" data-act="more-cands">Başka aday</button><button type="button" class="btn" data-act="fix">Yanlış, link gireceğim</button></div>` : "";
    const goUrl = i.best_url || i.akakce_url || i.source_url;
    const storeName = i.best_store ? String(i.best_store).replace("/", " · ") : "";
    // Tek dokunuşla en ucuz mağazaya git
    const cta = c != null && goUrl && !i.purchased
      ? `<a class="go" href="${esc(safeUrl(goUrl))}" target="_blank" rel="noopener"><span class="gs">${esc(storeName || "Mağazaya git")}</span><b>${tl(c)}</b><i>Git →</i></a>` : "";
    $("#detail").innerHTML = `
      <div class="sheet-head"><h2>Ürün detayı</h2><button type="button" class="x" data-close aria-label="Kapat">✕</button></div>
      <div class="d-img"><span class="ph">${esc(mono(i))}</span>${imgTag(i)}</div>
      <input id="dName" class="d-name" value="${esc(i.name)}" aria-label="Ürün adı">
      ${i.source_title ? `<div class="hint" style="padding:0">Linkindeki ürün: <b>${esc(i.source_title)}</b></div>` : ""}
      <div class="d-price"><b>${tl(c)}</b>${p != null && c != null && c < p ? `<s>${tl(p)}</s>` : ""}${q > 1 && c != null ? `<span>× ${q} = <b style="font-size:18px">${tl(c * q)}</b></span>` : ""}</div>
      <div class="d-badges">${overlayBadges(i, 9)}</div>
      <div class="ctaRow">${cta}${i.purchased ? `<button type="button" class="btn" data-act="undo">↩ Geri al</button>` : `<button type="button" class="btn buy" data-act="buy">✓ Aldık</button>`}</div>
      ${c != null ? (i.last_checked ? `<div class="hint" style="padding:0">Tarandı ${fmt(i.last_checked)}</div>` : "") : `<div class="hint" style="padding:0">Fiyat aranıyor… birkaç saniye içinde gelir. Gelmezse üstteki "↻ Yenile"ye bas.</div>`}
      ${warn}
      ${i.match_warn && !i.purchased ? `<div class="warn">${esc(i.match_warn)} <button type="button" class="btn" data-act="okwarn">Doğru, böyle kalsın</button><button type="button" class="btn" data-act="more-cands">Başka ürün seç</button><button type="button" class="btn" data-act="research">Yeniden ara</button></div>` : ""}
      ${candBlock(i)}
      ${i.last_error ? `<div class="err">⚠ ${esc(i.last_error)}</div>` : ""}
      <div class="dtabs" role="tablist">
        <button type="button" role="tab" data-dtab="prices" class="on">Fiyatlar</button>
        <button type="button" role="tab" data-dtab="hist">Geçmiş</button>
        <button type="button" role="tab" data-dtab="edit">Düzenle</button>
      </div>
      <div class="dpanel" data-panel="prices"><div id="offersBox">${offersBlock(i) || `<div class="hint">Mağaza fiyatları ilk taramadan sonra burada görünür.</div>`}</div></div>
      <div class="dpanel" data-panel="hist" hidden><div id="chart" class="chart"><div class="hint">Yükleniyor…</div></div></div>
      <div class="dpanel" data-panel="edit" hidden>
        <div class="row2">
          <label>Adet<input id="dQty" type="number" min="1" step="1" value="${q}" inputmode="numeric"></label>
          <label>Liste<select id="dList">${listOptions(spaceOf(i))}</select></label>
        </div>
        <div class="row2">
          <label>Kategori<select id="dCat">${catOptions(catOf(i), true)}</select></label>
          <label>Hedef fiyat ₺<input id="dTarget" type="number" min="0" step="1" inputmode="numeric" value="${i.target_price ?? ""}"></label>
        </div>
        <label>Not<textarea id="dNote" rows="2">${esc(i.note || "")}</textarea></label>
        <button type="button" class="primary" data-act="save">Kaydet</button>
        <div class="actions">
          ${i.source_url ? `<a class="btn" href="${esc(safeUrl(i.source_url))}" target="_blank" rel="noopener">Orijinal link</a>` : ""}
          ${i.akakce_url ? `<a class="btn" href="${esc(safeUrl(i.akakce_url))}" target="_blank" rel="noopener">Akakçe</a>` : ""}
          <button type="button" class="btn danger" data-act="del">Sil</button>
        </div>
      </div>`;
    detailDlg.showModal();
    loadHistory(id);
  }

  async function loadHistory(id) {
    const { data, error } = await db.from("price_history").select("price,checked_at").eq("item_id", id).order("checked_at", { ascending: true }).limit(400);
    if (openId !== id || !$("#chart")) return;
    if (error) { $("#chart").innerHTML = `<div class="hint">Geçmiş yüklenemedi.</div>`; return; }
    drawChart($("#chart"), data || []);
  }

  // Tek seri çizgi grafik: ince çizgi, silik ızgara, doğrudan etiket, hover ipucu, tablo görünümü.
  function drawChart(el, rows) {
    if (rows.length < 2) { el.innerHTML = `<div class="hint">Grafik için en az 2 tarama gerekli. Taramalar 2 saatte bir yapılır.</div>`; return; }
    const W = 320, H = 150, L = 52, R = 12, T = 16, B = 22;
    const xs = rows.map((r) => +new Date(r.checked_at)), ys = rows.map((r) => Number(r.price));
    const x0 = Math.min(...xs), x1 = Math.max(...xs), lo = Math.min(...ys), hi = Math.max(...ys);
    const span = hi - lo || hi * 0.05 || 1;
    const y0 = lo - span * 0.2, y1 = hi + span * 0.2;
    const X = (t) => L + (x1 === x0 ? 0 : ((t - x0) / (x1 - x0)) * (W - L - R));
    const Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
    const d = rows.map((r, k) => `${k ? "L" : "M"}${X(xs[k]).toFixed(1)},${Y(ys[k]).toFixed(1)}`).join(" ");
    const ticks = lo === hi ? [lo] : [lo, (lo + hi) / 2, hi];
    const lastI = rows.length - 1, minI = ys.lastIndexOf(lo);
    const lx = X(xs[lastI]), ly = Y(ys[lastI]);
    const short = (t) => new Date(t).toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Fiyat geçmişi grafiği: en düşük ${tl(lo)}, en yüksek ${tl(hi)}, son ${tl(ys[lastI])}">
        ${ticks.map((v) => `<line class="grid-l" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 3}" text-anchor="end">${tl(v)}</text>`).join("")}
        <path class="ln" d="${d}"/>
        ${minI !== lastI && lo !== hi ? `<circle class="dot" cx="${X(xs[minI])}" cy="${Y(lo)}" r="3.5"/><text class="lab" x="${X(xs[minI])}" y="${Y(lo) + 14}" text-anchor="middle">en düşük</text>` : ""}
        <circle class="dot" cx="${lx}" cy="${ly}" r="4.5"/>
        <text class="lab" x="${lx}" y="${ly - 9}" text-anchor="end">${tl(ys[lastI])}</text>
        <text x="${L}" y="${H - 6}">${short(x0)}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${short(x1)}</text>
        <line class="cross" id="cx" y1="${T}" y2="${H - B}" style="display:none"/><circle class="dot" id="cd" r="4" style="display:none"/>
      </svg><div class="tip" id="tip" style="display:none"></div>
      <details><summary>Tablo olarak gör</summary><table><thead><tr><th>Tarih</th><th>Fiyat</th></tr></thead><tbody>${rows.slice(-12).reverse().map((r) => `<tr><td>${fmt(r.checked_at)}</td><td>${tl(r.price)}</td></tr>`).join("")}</tbody></table></details>`;
    const svg = el.querySelector("svg"), cx = el.querySelector("#cx"), cd = el.querySelector("#cd"), tip = el.querySelector("#tip");
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const sx = ((ev.clientX - r.left) / r.width) * W;
      let k = 0, best = Infinity;
      xs.forEach((t, n) => { const dd = Math.abs(X(t) - sx); if (dd < best) { best = dd; k = n; } });
      const px = X(xs[k]), py = Y(ys[k]);
      cx.setAttribute("x1", px); cx.setAttribute("x2", px); cd.setAttribute("cx", px); cd.setAttribute("cy", py);
      cx.style.display = cd.style.display = "";
      tip.textContent = `${fmt(rows[k].checked_at)} · ${tl(ys[k])}`;
      tip.style.left = (px / W) * r.width + "px"; tip.style.top = (py / H) * r.height + "px"; tip.style.display = "";
    };
    const leave = () => { cx.style.display = cd.style.display = tip.style.display = "none"; };
    svg.addEventListener("pointermove", move); svg.addEventListener("pointerdown", move); svg.addEventListener("pointerleave", leave);
  }

  $("#detail").onclick = async (e) => {
    const tb = e.target.closest("[data-dtab]");
    if (tb) { // sekme değiştir
      document.querySelectorAll("#detail [data-dtab]").forEach((x) => x.classList.toggle("on", x === tb));
      document.querySelectorAll("#detail .dpanel").forEach((pn) => (pn.hidden = pn.dataset.panel !== tb.dataset.dtab));
      return;
    }
    const b = e.target.closest("[data-act]");
    if (!b || !openId) return;
    const id = openId, act = b.dataset.act;
    if (act === "save") {
      const ok = await upd(id, {
        name: $("#dName").value.trim() || "İsimsiz ürün",
        quantity: Math.max(1, Number($("#dQty").value) || 1),
        category: $("#dCat").value || "Genel",
        owner: $("#dList").value || null,
        target_price: $("#dTarget").value ? Number($("#dTarget").value) : null,
        note: $("#dNote").value.trim() || null,
      });
      if (ok) detailDlg.close();
    } else if (act === "buy") { await upd(id, { purchased: true, purchased_at: new Date().toISOString() }); detailDlg.close(); }
    else if (act === "undo") { await upd(id, { purchased: false, purchased_at: null }); detailDlg.close(); }
    else if (act === "ok" || act === "okwarn") { await upd(id, { match_confirmed: true, match_state: "confirmed", match_note: null, match_warn: "" }); openDetail(id); } // match_warn "" = "doğru dedim, bir daha uyarma"
    else if (act === "offers-all" || act === "offers-big") {
      offerMode = act === "offers-big" ? "big" : "all";
      try { localStorage.setItem("offerMode", offerMode); } catch {}
      offersOpen = false;
      refreshOffers();
    } else if (act === "offers-more") { offersOpen = !offersOpen; refreshOffers(); }
    else if (act === "more-cands") {
      const it = items.find((x) => x.id === id);
      if (it && (it.candidates || []).length && !it.match_warn) { const d = $("#detail .cands"); if (d) { d.open = true; d.scrollIntoView({ block: "center" }); } return; }
      await requestResearch(id);
    } else if (act === "research") { await requestResearch(id); }
    else if (act === "pickc") { if (await pickCandidate(id, Number(b.dataset.idx))) detailDlg.close(); }
    else if (act === "fix") {
      const u = prompt("Doğru Akakçe ürün linkini yapıştır:");
      if (!u) return;
      if (!/akakce\.com/i.test(u)) return alert("Bu bir Akakçe linki değil.");
      await upd(id, { akakce_url: u.trim(), match_confirmed: true, match_state: "confirmed", match_note: null, last_error: null, current_price: null, prev_price: null, lowest_price: null, highest_price: null, offers: [], offers_total: null });
      detailDlg.close();
    } else if (act === "del") {
      if (!confirm("Bu ürün listeden silinsin mi?")) return;
      const { error } = await db.from("items").delete().eq("id", id);
      if (error) return alert("Hata: " + error.message);
      detailDlg.close();
      load();
    }
  };

  // ---------- fiyatları yenile ----------
  // Telefon GitHub'a değil Supabase'e "taramayı başlat" der (anahtar Supabase'de saklı, cihazda yok).
  // Bitişi tahminle değil, taramanın yazdığı durumdan (settings.scan_status) öğrenir.
  function setScanUi(on, label) {
    const b = $("#refreshBtn");
    b.disabled = on;
    b.textContent = on ? label : "↻ Yenile";
    $("#scanbar").hidden = !on;
  }
  async function finishScan(v) {
    scanning = false;
    setScanUi(false);
    await load();
    if (!v) toast("Tarama beklenenden uzun sürdü. Birazdan sayfayı yenile.");
    else if (v.error) toast("Tarama hata verdi: " + v.error);
    else toast(`Fiyatlar güncellendi${v.ask ? ` · ${v.ask} ürün seçim bekliyor` : ""}`);
    if (rescan) { rescan = false; scheduleScan(null, 500); } // tarama sürerken eklenenler için bir tur daha
  }
  async function requestScan() {
    if (scanning) { rescan = true; return; }
    scanning = true;
    setScanUi(true, "Başlatılıyor…");
    let since = Date.now() - 3000;
    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try { res = await db.rpc("request_scan"); } catch (e) { res = { error: e }; }
      if (res.error) { scanning = false; setScanUi(false); return alert("Tarama istenemedi: " + (res.error.message || res.error)); }
      const d = res.data || {};
      if (d.reason === "no_token") { scanning = false; setScanUi(false); return alert("Tarama başlatılamadı: Supabase'deki GitHub anahtarı eksik ya da süresi dolmuş. Bana yaz, yenileyeyim."); }
      if (d.ok) { if (d.at) since = Date.parse(d.at) - 1000; break; } // sunucu saatiyle karşılaştır: telefon saati yanlış olsa da çalışır
      if (d.reason === "too_soon") { // en çok 45 sn önce başka bir tarama istenmiş: sınır dolunca yeniden iste, böylece son eklenenler de taranır
        for (let sec = Math.max(1, Number(d.wait) || 45); sec > 0; sec--) { setScanUi(true, `Sırada… ${sec} sn`); await sleep(1000); }
        continue;
      }
      break;
    }
    const t0 = Date.now();
    for (;;) {
      const sec = Math.round((Date.now() - t0) / 1000);
      const { data } = await db.from("settings").select("*");
      const v = ((data || []).find((r) => r.key === "scan_status") || {}).value;
      if (v && v.state === "done" && Date.parse(v.finished_at) >= since) return finishScan(v);
      setScanUi(true, v && v.state === "running" && Date.parse(v.started_at) >= since ? `Taranıyor… ${sec} sn` : `Başlatılıyor… ${sec} sn`);
      if (sec > 300) return finishScan(null);
      if (sec % 9 < 3) load(); // ürünler güncellendikçe ekrana gelsin
      await sleep(3000);
    }
  }
  $("#refreshBtn").onclick = () => requestScan();
  // Ürün ekleyince / eşleşme seçince taramayı kendiliğinden başlat; peş peşe işlemlerde son işlemden sonra bir kere.
  let scanTimer;
  function scheduleScan(msg, delay = 8000) {
    if (msg) toast(msg);
    clearTimeout(scanTimer);
    scanTimer = setTimeout(requestScan, delay);
  }

  db.channel("items").on("postgres_changes", { event: "*", schema: "public", table: "items" }, queueLoad).subscribe();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) queueLoad(); });

  // Android "Paylaş → SC İhtiyaç" (ve ?url= ile gelen link): ekleme formu açılıp doldurulur.
  let shareUrl = "";
  try {
    const q = new URLSearchParams(location.search);
    const m = (q.get("url") || q.get("text") || q.get("title") || "").match(/https?:\/\/[^\s]+/i);
    if (m) { shareUrl = m[0]; history.replaceState(null, "", location.pathname); }
  } catch { /* adres okunamadı */ }
  load().then(() => { if (shareUrl) openAdd(shareUrl); });

  // Servis çalışanı: yüklenebilir uygulama + paylaşarak ekleme için. Önce ağ, olmazsa önbellek.
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
