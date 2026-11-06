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
  const F = { q: "", prio: "all", who: "all", cat: "all", sort: "cat" };
  let selMode = false;
  const sel = new Set();

  // ---------- yardımcılar ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const tl = (n) => (n == null || isNaN(n) ? "—" : Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " ₺");
  const num = (v) => (v == null || v === "" ? null : Number(v));
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "#");
  const qty = (i) => Math.max(1, Number(i.quantity) || 1);
  const unit = (i) => num(i.current_price);
  const line = (i) => (unit(i) || 0) * qty(i);
  const prioOf = (i) => (i.priority === "iyi" ? "iyi" : "sart");
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
    const base = items.filter((i) => (tab === "bought" ? i.purchased : !i.purchased));
    const counts = {};
    base.forEach((i) => { counts[catOf(i)] = (counts[catOf(i)] || 0) + 1; });
    const keys = Object.keys(counts).sort((a, b) => catOrder(a) - catOrder(b) || a.localeCompare(b, "tr"));
    if (F.cat !== "all" && !counts[F.cat]) F.cat = "all";
    $("#catSel").innerHTML = `<option value="all">Tüm kategoriler</option>` + keys.map((c) => `<option value="${esc(c)}" ${F.cat === c ? "selected" : ""}>${esc(catLabel(c))} (${counts[c]})</option>`).join("");
    const fc = $("#fCat"), cur = fc.value || "Genel";
    fc.innerHTML = catOptions(allCats().includes(cur) ? cur : "Genel", true);
    $("#selCat").innerHTML = `<option value="">Kategori değiştir…</option>` + allCats().map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  }

  const getWho = () => { try { return localStorage.getItem("who") || ""; } catch { return ""; } };
  const setWho = (v) => { try { localStorage.setItem("who", v); } catch {} };
  function renderWho() { $("#whoBtn").textContent = getWho() || "ismini yaz"; }
  $("#whoBtn").onclick = () => {
    const v = prompt("Adın ne? (ürünü kimin eklediği görünsün)", getWho());
    if (v != null) { setWho(v.trim()); renderWho(); }
  };
  if (!getWho()) setTimeout(() => $("#whoBtn").click(), 300);
  renderWho();

  function nameFromUrl(url) {
    try {
      const parts = new URL(url).pathname.split("/").filter(Boolean);
      let s = parts.filter((p) => p.includes("-")).sort((a, b) => b.length - a.length)[0] || parts.pop() || "";
      s = s.replace(/\.html?$/i, "").replace(/-p-\d+$/i, "").replace(/-(pm|p)-[a-z0-9]+$/i, "").replace(/,\d+$/, "").replace(/^en-ucuz-/, "").replace(/-fiyati$/, "");
      return decodeURIComponent(s).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
    } catch { return ""; }
  }

  // ---------- veri ----------
  async function load() {
    const [a, b] = await Promise.all([
      db.from("items").select("*").order("created_at", { ascending: false }),
      db.from("settings").select("*"),
    ]);
    if (a.error) { $("#items").innerHTML = `<div class="empty">Liste yüklenemedi: ${esc(a.error.message)}</div>`; return; }
    items = a.data;
    if (!b.error && Array.isArray(b.data)) {
      const row = b.data.find((r) => r.key === "budget");
      budget = row && row.value && row.value.amount != null ? Number(row.value.amount) : null;
    }
    render();
  }

  async function upd(id, patch) {
    const { error } = await db.from("items").update(patch).eq("id", id);
    if (error) alert("Kaydedilemedi: " + error.message + (/column|schema/i.test(error.message) ? "\n\nSupabase'de yeni sütunlar eksik olabilir (supabase/schema.sql v2 bölümü)." : ""));
    await load();
    return !error;
  }

  // ---------- bütçe ----------
  function renderBudget() {
    const open = items.filter((i) => !i.purchased), done = items.filter((i) => i.purchased);
    const spent = done.reduce((s, i) => s + line(i), 0);
    const pend = open.reduce((s, i) => s + line(i), 0);
    let html = `<div class="bud-top"><span>Bütçe</span><button id="budEdit" type="button">${budget != null ? tl(budget) : "Belirle"} <small>düzenle</small></button></div>`;
    if (budget != null && budget > 0) {
      const sp = Math.min(100, (spent / budget) * 100);
      const pp = Math.min(100 - sp, (pend / budget) * 100);
      const left = budget - spent - pend;
      html += `<div class="bar ${left < 0 ? "over" : ""}" role="img" aria-label="Harcanan ve bekleyen toplam"><i class="spent" style="width:${sp}%"></i><i class="pend" style="width:${pp}%"></i></div>
        <div class="bud-nums"><span>Harcanan <b>${tl(spent)}</b></span><span>Bekleyen <b>${tl(pend)}</b></span><span class="${left < 0 ? "neg" : ""}">${left < 0 ? "Aşım" : "Kalan"} <b>${tl(Math.abs(left))}</b></span></div>`;
    } else {
      html += `<div class="bud-nums" style="margin-top:8px"><span>Harcanan <b>${tl(spent)}</b></span><span>Bekleyen <b>${tl(pend)}</b></span></div>`;
    }
    const cats = {};
    items.forEach((i) => { const c = catOf(i); cats[c] = (cats[c] || 0) + line(i); });
    const entries = Object.entries(cats).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (entries.length) {
      const max = entries[0][1];
      html += `<details><summary>Kategorilere göre</summary>${entries.map(([c, v]) => `<div class="cat-row"><span>${esc(catLabel(c))}</span><div class="t"><i style="width:${Math.max(4, (v / max) * 100)}%"></i></div><b>${tl(v)}</b></div>`).join("")}</details>`;
    }
    $("#budget").innerHTML = html;
  }
  $("#budget").onclick = async (e) => {
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
    const people = [...new Set(items.map((i) => (i.assignee || "").trim()).filter(Boolean))];
    const chip = (kind, val, label) => `<button type="button" class="chip ${F[kind] === val ? "on" : ""}" data-kind="${kind}" data-val="${esc(val)}">${label}</button>`;
    let h = chip("prio", "all", "Hepsi") + chip("prio", "sart", "Şart") + chip("prio", "iyi", "Olsa iyi");
    if (people.length) h += `<span class="sep"></span>` + chip("who", "all", "Herkes") + people.map((p) => chip("who", p, esc(p))).join("");
    $("#chips").innerHTML = h;
    fillCategorySelects();
    const names = new Set([...people, ...items.map((i) => (i.added_by || "").trim()).filter(Boolean), getWho()].filter(Boolean));
    $("#people").innerHTML = [...names].map((p) => `<option value="${esc(p)}">`).join("");
  }
  $("#chips").onclick = (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    F[b.dataset.kind] = b.dataset.val;
    render();
  };
  $("#q").oninput = (e) => { F.q = e.target.value; render(); };
  $("#sort").onchange = (e) => { F.sort = e.target.value; render(); };
  $("#catSel").onchange = (e) => { F.cat = e.target.value; render(); };

  // ---------- galeri ----------
  function visible() {
    let list = items.filter((i) => (tab === "bought" ? i.purchased : !i.purchased));
    if (tab === "deals") list = list.filter(isDeal);
    const q = F.q.trim().toLocaleLowerCase("tr");
    if (q) list = list.filter((i) => [i.name, i.category, i.note, i.assignee].join(" ").toLocaleLowerCase("tr").includes(q));
    if (F.prio !== "all") list = list.filter((i) => prioOf(i) === F.prio);
    if (F.who !== "all") list = list.filter((i) => (i.assignee || "").trim() === F.who);
    if (F.cat !== "all") list = list.filter((i) => catOf(i) === F.cat);
    const byPrice = (a, b) => (unit(a) ?? Infinity) - (unit(b) ?? Infinity);
    if (F.sort === "price-asc") list = [...list].sort(byPrice);
    else if (F.sort === "price-desc") list = [...list].sort((a, b) => (unit(b) ?? -1) - (unit(a) ?? -1));
    else if (F.sort === "drop") list = [...list].sort((a, b) => dropPct(b) - dropPct(a));
    return list;
  }

  function overlayBadges(i) {
    let h = "";
    const d = dropPct(i);
    if (d) h += `<span class="badge b-down">↓ %${d}</span>`;
    else if (unit(i) != null && num(i.prev_price) != null && unit(i) > num(i.prev_price)) h += `<span class="badge b-up">↑ %${Math.round(((unit(i) - num(i.prev_price)) / num(i.prev_price)) * 100)}</span>`;
    if (isLowest(i)) h += `<span class="badge b-low">En düşük</span>`;
    if (hitTarget(i)) h += `<span class="badge b-hit">Hedefte</span>`;
    return h;
  }
  const mono = (i) => (String(i.name || "?").trim().charAt(0) || "?").toLocaleUpperCase("tr");
  const imgTag = (i) => i.image_url && /^https:\/\//.test(i.image_url)
    ? `<img src="${esc(i.image_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : "";

  function gcard(i) {
    const c = unit(i), p = num(i.prev_price), q = qty(i);
    const tags = [
      `<span class="tag ${prioOf(i)}">${prioOf(i) === "sart" ? "Şart" : "Olsa iyi"}</span>`,
      i.assignee ? `<span class="tag who">${esc(i.assignee)}</span>` : "",
      i.note ? `<span class="tag" title="${esc(i.note)}">Not</span>` : "",
    ].join("");
    return `<article class="gcard ${i.purchased ? "done" : ""} ${selMode ? "selectable" : ""} ${sel.has(i.id) ? "picked" : ""}" data-id="${i.id}" tabindex="0">
      <div class="imgwrap"><span class="ph">${esc(mono(i))}</span>${imgTag(i)}<span class="pick" aria-hidden="true">✓</span>
        <div class="ov">${overlayBadges(i)}</div>
        <button type="button" class="quick" data-act="${i.purchased ? "undo" : "buy"}" data-id="${i.id}" aria-label="${i.purchased ? "Geri al" : "Aldık olarak işaretle"}">${i.purchased ? "↩" : "✓"}</button>
      </div>
      <div class="gbody">
        <div class="gname">${esc(i.name)}</div>
        <div class="gprice"><b>${c != null ? tl(c) : "…"}</b>${p != null && c != null && c < p ? `<s>${tl(p)}</s>` : ""}${q > 1 ? `<em>× ${q}</em>` : ""}</div>
        <div class="gstore">${c != null ? esc(i.best_store || "") : "ilk tarama bekleniyor"}</div>
        <div class="tags">${tags}</div>
      </div>
    </article>`;
  }

  function render() {
    renderBudget();
    renderChips();
    const open = items.filter((i) => !i.purchased);
    $("#cList").textContent = open.length;
    $("#cDeals").textContent = open.filter(isDeal).length;
    $("#cBought").textContent = items.filter((i) => i.purchased).length;
    const last = items.map((i) => i.last_checked).filter(Boolean).sort().pop();
    $("#lastScan").textContent = last ? "Son tarama: " + fmt(last) : "Henüz taranmadı";
    const hrs = last ? (Date.now() - new Date(last).getTime()) / 3600000 : 0;
    const stale = $("#stale");
    stale.hidden = !(open.length && last && hrs > 5);
    if (!stale.hidden) stale.textContent = `Son tarama ${Math.floor(hrs)} saat önce yapıldı, otomatik tarama gecikmiş olabilir. "Fiyatları yenile"ye basabilirsin.`;

    const list = visible();
    const total = list.reduce((s, i) => s + line(i), 0);
    $("#summary").textContent = list.length ? `${list.length} ürün · ${tab === "bought" ? "harcanan" : "toplam"} ${tl(total)}${list.some((i) => qty(i) > 1) ? " (adetler dahil)" : ""}` : "";

    if (!list.length) {
      const filtered = F.q || F.prio !== "all" || F.who !== "all" || F.cat !== "all";
      $("#items").innerHTML = `<div class="empty">${filtered ? "Filtreye uyan ürün yok." : tab === "list" ? "Liste boş. Sağ alttaki + ile ilk ürünü ekle." : tab === "deals" ? "Şu an indirimde ürün yok." : "Henüz bir şey almadınız."}</div>`;
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

  document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => {
    tab = b.dataset.tab;
    sel.clear();
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x === b));
    render();
  }));

  $("#items").onclick = async (e) => {
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
      return upd(id, q.dataset.act === "buy" ? { purchased: true, purchased_at: new Date().toISOString() } : { purchased: false, purchased_at: null });
    }
    const card = e.target.closest(".gcard");
    if (card) openDetail(card.dataset.id);
  };
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
    ["#selBuy", "#selDel", "#selCat"].forEach((s) => ($(s).disabled = none));
    $("#selBuy").textContent = tab === "bought" ? "Geri al" : "Aldık";
  }
  async function bulk(patch) {
    const { error } = await db.from("items").update(patch).in("id", [...sel]);
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
  $("#fab").onclick = () => { renderChips(); addDlg.showModal(); $("#fUrl").focus(); };
  [addDlg, detailDlg].forEach((d) => d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-close]")) d.close(); }));
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
      category: cat,
      quantity: Math.max(1, Number($("#fQty").value) || 1),
      priority: $("#fPrio").value,
      assignee: $("#fWho").value.trim() || null,
      target_price: $("#fTarget").value ? Number($("#fTarget").value) : null,
      note: $("#fNote").value.trim() || null,
      added_by: getWho() || null,
    };
    const { error } = await db.from("items").insert(row);
    if (error) return alert("Eklenemedi: " + error.message + (/column|schema/i.test(error.message) ? "\n\nSupabase'de yeni sütunlar eksik (supabase/schema.sql v2 bölümü)." : ""));
    e.target.reset();
    $("#fQty").value = 1;
    addDlg.close();
    load();
  };

  // ---------- ürün detayı ----------
  function openDetail(id) {
    const i = items.find((x) => x.id === id);
    if (!i) return;
    openId = id;
    const offers = Array.isArray(i.offers) ? i.offers : [];
    const c = unit(i), p = num(i.prev_price), q = qty(i);
    const warn = i.akakce_url && !i.match_confirmed && !i.purchased
      ? `<div class="warn">Bu eşleşme doğru mu? <a href="${esc(safeUrl(i.akakce_url))}" target="_blank" rel="noopener">Akakçe sayfasına bak</a>
         <button type="button" class="btn" data-act="ok">Doğru</button><button type="button" class="btn" data-act="fix">Yanlış, link gireceğim</button></div>` : "";
    $("#detail").innerHTML = `
      <div class="sheet-head"><h2>Ürün detayı</h2><button type="button" class="x" data-close aria-label="Kapat">✕</button></div>
      <div class="d-img"><span class="ph">${esc(mono(i))}</span>${imgTag(i)}</div>
      <input id="dName" class="d-name" value="${esc(i.name)}" aria-label="Ürün adı">
      <div class="d-price"><b>${tl(c)}</b>${p != null && c != null && c < p ? `<s>${tl(p)}</s>` : ""}${q > 1 && c != null ? `<span>× ${q} = <b style="font-size:18px">${tl(c * q)}</b></span>` : ""}</div>
      <div class="d-badges">${overlayBadges(i)}</div>
      ${c != null ? `<div class="hint" style="padding:0">En ucuz: ${i.best_url ? `<a href="${esc(safeUrl(i.best_url))}" target="_blank" rel="noopener">${esc(i.best_store || "")}</a>` : esc(i.best_store || "")}${i.last_checked ? " · tarandı " + fmt(i.last_checked) : ""}</div>` : `<div class="hint" style="padding:0">İlk tarama bekleniyor (en geç 2 saat). Üstteki "Fiyatları yenile" ile hemen başlatabilirsin.</div>`}
      ${warn}
      ${i.last_error ? `<div class="err">⚠ ${esc(i.last_error)}</div>` : ""}
      ${offers.length > 1 ? `<div class="sec">Mağazalar</div><ul class="offers">${offers.map((o) => `<li><a href="${esc(safeUrl(o.url))}" target="_blank" rel="noopener">${esc(o.store)}</a><b>${tl(o.price)}</b></li>`).join("")}</ul>` : ""}
      <div class="sec">Fiyat geçmişi</div>
      <div id="chart" class="chart"><div class="hint">Yükleniyor…</div></div>
      <div class="sec">Düzenle</div>
      <div class="row2">
        <label>Adet<input id="dQty" type="number" min="1" step="1" value="${q}" inputmode="numeric"></label>
        <label>Öncelik<select id="dPrio"><option value="sart" ${prioOf(i) === "sart" ? "selected" : ""}>Şart</option><option value="iyi" ${prioOf(i) === "iyi" ? "selected" : ""}>Olsa iyi olur</option></select></label>
      </div>
      <div class="row2">
        <label>Kim alacak?<input id="dWho" list="people" value="${esc(i.assignee || "")}"></label>
        <label>Kategori<select id="dCat">${catOptions(catOf(i), true)}</select></label>
      </div>
      <label>Hedef fiyat ₺<input id="dTarget" type="number" min="0" step="1" inputmode="numeric" value="${i.target_price ?? ""}"></label>
      <label>Not<textarea id="dNote" rows="2">${esc(i.note || "")}</textarea></label>
      <button type="button" class="primary" data-act="save">Kaydet</button>
      <div class="actions">
        ${i.purchased ? `<button type="button" class="btn" data-act="undo">↩ Geri al</button>` : `<button type="button" class="btn buy" data-act="buy">✓ Aldık</button>`}
        ${i.source_url ? `<a class="btn" href="${esc(safeUrl(i.source_url))}" target="_blank" rel="noopener">Orijinal link</a>` : ""}
        ${i.akakce_url ? `<a class="btn" href="${esc(safeUrl(i.akakce_url))}" target="_blank" rel="noopener">Akakçe</a>` : ""}
        <button type="button" class="btn danger" data-act="del">Sil</button>
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
    const b = e.target.closest("[data-act]");
    if (!b || !openId) return;
    const id = openId, act = b.dataset.act;
    if (act === "save") {
      const ok = await upd(id, {
        name: $("#dName").value.trim() || "İsimsiz ürün",
        quantity: Math.max(1, Number($("#dQty").value) || 1),
        priority: $("#dPrio").value,
        assignee: $("#dWho").value.trim() || null,
        category: $("#dCat").value || "Genel",
        target_price: $("#dTarget").value ? Number($("#dTarget").value) : null,
        note: $("#dNote").value.trim() || null,
      });
      if (ok) detailDlg.close();
    } else if (act === "buy") { await upd(id, { purchased: true, purchased_at: new Date().toISOString() }); detailDlg.close(); }
    else if (act === "undo") { await upd(id, { purchased: false, purchased_at: null }); detailDlg.close(); }
    else if (act === "ok") { await upd(id, { match_confirmed: true }); openDetail(id); }
    else if (act === "fix") {
      const u = prompt("Doğru Akakçe ürün linkini yapıştır:");
      if (!u) return;
      if (!/akakce\.com/i.test(u)) return alert("Bu bir Akakçe linki değil.");
      await upd(id, { akakce_url: u.trim(), match_confirmed: true, last_error: null, current_price: null, prev_price: null, lowest_price: null, highest_price: null });
      detailDlg.close();
    } else if (act === "del") {
      if (!confirm("Bu ürün listeden silinsin mi?")) return;
      const { error } = await db.from("items").delete().eq("id", id);
      if (error) return alert("Hata: " + error.message);
      detailDlg.close();
      load();
    }
  };

  // ---------- manuel fiyat yenileme (GitHub Actions taramasını başlatır) ----------
  const getTok = () => { try { return localStorage.getItem("ghtok") || ""; } catch { return ""; } };
  const setTok = (v) => { try { v ? localStorage.setItem("ghtok", v) : localStorage.removeItem("ghtok"); } catch {} };
  const lastCheck = () => items.map((i) => i.last_checked).filter(Boolean).sort().pop() || "";
  function repoInfo() {
    const m = location.hostname.match(/^(.+)\.github\.io$/);
    const repo = location.pathname.split("/").filter(Boolean)[0];
    return m && repo ? { owner: m[1], repo } : null;
  }
  const showTokBtn = () => { $("#tokReset").hidden = !getTok(); };
  showTokBtn();
  $("#tokReset").onclick = () => { if (confirm("Kayıtlı GitHub anahtarı bu cihazdan silinsin mi?")) { setTok(""); showTokBtn(); } };

  $("#refreshBtn").onclick = async () => {
    const btn = $("#refreshBtn");
    const info = repoInfo();
    if (!info) return alert("Yenileme sadece yayınlanmış github.io adresinde çalışır.");
    let tok = getTok();
    if (!tok) {
      tok = (prompt("İlk kullanımda GitHub izin anahtarı gerekiyor (bu cihazda saklanır, bir kere girilir).\nNasıl alınacağı README.md'de yazıyor.\n\nAnahtarı yapıştır:") || "").trim();
      if (!tok) return;
      setTok(tok); showTokBtn();
    }
    btn.disabled = true; btn.textContent = "Başlatılıyor…";
    const before = lastCheck();
    let r;
    try {
      r = await fetch(`https://api.github.com/repos/${info.owner}/${info.repo}/actions/workflows/scan.yml/dispatches`, {
        method: "POST",
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${tok}`, "X-GitHub-Api-Version": "2022-11-28" },
        body: JSON.stringify({ ref: "main" }),
      });
    } catch (e) {
      btn.disabled = false; btn.textContent = "↻ Fiyatları yenile";
      return alert("GitHub'a ulaşılamadı. İnternetini kontrol et.");
    }
    if (r.status !== 204) {
      btn.disabled = false; btn.textContent = "↻ Fiyatları yenile";
      if ([401, 403, 404].includes(r.status)) { setTok(""); showTokBtn(); return alert("GitHub anahtarı geçersiz ya da izni yok (kod " + r.status + "). Anahtarı README'deki gibi yeniden oluşturup tekrar dene."); }
      return alert("Tarama başlatılamadı (kod " + r.status + ").");
    }
    // Bitişi tahminle değil GitHub'dan öğren: 3 saniyede bir çalışmanın gerçek durumuna bakar.
    const t0 = Date.now();
    const api = `https://api.github.com/repos/${info.owner}/${info.repo}/actions/workflows/scan.yml/runs?event=workflow_dispatch&per_page=5`;
    const hdr = { Accept: "application/vnd.github+json", Authorization: `Bearer ${tok}`, "X-GitHub-Api-Version": "2022-11-28" };
    const finish = async (msg) => {
      btn.disabled = false; btn.textContent = "↻ Fiyatları yenile";
      await load();
      if (msg) alert(msg);
    };
    const tick = async () => {
      const sec = Math.round((Date.now() - t0) / 1000);
      try {
        const rr = await fetch(api, { headers: hdr });
        if (rr.ok) {
          const runs = (await rr.json()).workflow_runs || [];
          const run = runs.find((x) => new Date(x.created_at).getTime() >= t0 - 20000);
          if (run && run.status === "completed") return finish(run.conclusion === "success" ? "" : "Tarama hata verdi. GitHub'da Actions sekmesindeki kaydı kontrol et.");
          btn.textContent = run ? `Taranıyor… ${sec} sn` : `Başlatılıyor… ${sec} sn`;
        }
      } catch (e) { /* geçici ağ hatası: tekrar dene */ }
      if (sec > 300) return finish("Tarama beklenenden uzun sürdü. Birkaç dakika sonra sayfayı yenile.");
      if (sec % 9 < 3) load(); // ürünler güncellendikçe ekrana gelsin
      setTimeout(tick, 3000);
    };
    tick();
  };

  db.channel("items").on("postgres_changes", { event: "*", schema: "public", table: "items" }, () => { if (!openId) load(); }).subscribe();
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !openId) load(); });
  load();
})();
