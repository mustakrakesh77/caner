(() => {
  const $ = (s) => document.querySelector(s);
  const cfg = window.CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    $("#setup").hidden = false;
    return;
  }
  const db = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  let items = [];
  let tab = "list";

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const tl = (n) => (n == null ? "—" : Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " ₺");
  const num = (v) => (v == null ? null : Number(v));
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "#");

  // Kim ekliyor
  const getWho = () => { try { return localStorage.getItem("who") || ""; } catch { return ""; } };
  const setWho = (v) => { try { localStorage.setItem("who", v); } catch {} };
  function renderWho() { $("#whoBtn").textContent = getWho() || "ismini yaz"; }
  $("#whoBtn").onclick = () => {
    const v = prompt("Adın ne? (ürünü kimin eklediği görünsün)", getWho());
    if (v != null) { setWho(v.trim()); renderWho(); }
  };
  if (!getWho()) setTimeout(() => $("#whoBtn").click(), 300);
  renderWho();

  // Linkten ürün adı tahmini
  function nameFromUrl(url) {
    try {
      const parts = new URL(url).pathname.split("/").filter(Boolean);
      let s = parts.filter((p) => p.includes("-")).sort((a, b) => b.length - a.length)[0] || parts.pop() || "";
      s = s.replace(/\.html?$/i, "").replace(/-p-\d+$/i, "").replace(/-(pm|p)-[a-z0-9]+$/i, "").replace(/,\d+$/, "").replace(/^en-ucuz-/, "").replace(/-fiyati$/, "");
      return decodeURIComponent(s).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
    } catch { return ""; }
  }

  async function load() {
    const { data, error } = await db.from("items").select("*").order("created_at", { ascending: false });
    if (error) { $("#items").innerHTML = `<div class="empty">Liste yüklenemedi: ${esc(error.message)}</div>`; return; }
    items = data;
    render();
  }

  const isDeal = (i) => {
    const c = num(i.current_price), p = num(i.prev_price), t = num(i.target_price);
    return (c != null && p != null && c < p) || (c != null && t != null && c <= t);
  };

  function badges(i) {
    const c = num(i.current_price), p = num(i.prev_price), t = num(i.target_price);
    let h = "";
    if (c != null && p != null && c !== p) {
      const pct = Math.round((Math.abs(c - p) / p) * 100);
      h += c < p ? `<span class="badge down">↓ %${pct}</span>` : `<span class="badge up">↑ %${pct}</span>`;
    }
    if (c != null && t != null && c <= t) h += `<span class="badge hit">🎯 hedefte</span>`;
    return h;
  }

  function card(i) {
    const offers = Array.isArray(i.offers) ? i.offers : [];
    const matchWarn = i.akakce_url && !i.match_confirmed && !i.purchased
      ? `<div class="warn">Bu eşleşme doğru mu? <a href="${esc(safeUrl(i.akakce_url))}" target="_blank" rel="noopener">Akakçe sayfasına bak</a>
         <button data-act="ok" data-id="${i.id}">Doğru</button>
         <button data-act="fix" data-id="${i.id}">Yanlış, link gireceğim</button></div>` : "";
    const wait = !i.akakce_url && !i.last_error ? `<div class="meta">İlk tarama bekleniyor (en geç 2 saat)…</div>` : "";
    const img = i.image_url && /^https:\/\//.test(i.image_url)
      ? `<img class="thumb" src="${esc(i.image_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : "";
    return `<div class="card item">
      <div class="top">
        ${img}
        <div class="info">
          <h3>${esc(i.name)}</h3>
          <div class="meta">${i.added_by ? esc(i.added_by) + " ekledi · " : ""}${i.target_price ? "hedef " + tl(i.target_price) + " · " : ""}${i.last_checked ? "tarandı " + new Date(i.last_checked).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</div>
        </div>
        <div class="price"><b>${tl(i.current_price)}</b>${badges(i)}<small>${i.best_url ? `<a href="${esc(safeUrl(i.best_url))}" target="_blank" rel="noopener">${esc(i.best_store || "")}</a>` : esc(i.best_store || "")}</small></div>
      </div>
      ${wait}${matchWarn}
      ${i.last_error ? `<div class="err">⚠ ${esc(i.last_error)}</div>` : ""}
      ${offers.length > 1 ? `<details><summary>Diğer mağazalar (${offers.length})</summary><ul>${offers.map((o) => `<li><a href="${esc(safeUrl(o.url))}" target="_blank" rel="noopener">${esc(o.store)}</a><b>${tl(o.price)}</b></li>`).join("")}</ul></details>` : ""}
      <div class="actions">
        ${i.purchased ? `<button data-act="undo" data-id="${i.id}">Geri al</button>` : `<button class="buy" data-act="buy" data-id="${i.id}">✓ Aldık</button>`}
        ${i.source_url ? `<button onclick="window.open('${esc(safeUrl(i.source_url))}','_blank','noopener')">Orijinal link</button>` : ""}
        <button class="del" data-act="del" data-id="${i.id}">Sil</button>
      </div>
    </div>`;
  }

  function render() {
    const open = items.filter((i) => !i.purchased);
    const deals = open.filter(isDeal);
    const bought = items.filter((i) => i.purchased);
    $("#cList").textContent = open.length;
    $("#cDeals").textContent = deals.length;
    $("#cBought").textContent = bought.length;
    const last = items.map((i) => i.last_checked).filter(Boolean).sort().pop();
    $("#lastScan").textContent = last ? "Son tarama: " + new Date(last).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Henüz taranmadı";

    $("#cats").innerHTML = [...new Set(items.map((i) => i.category).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join("");

    let list = tab === "list" ? open : tab === "deals" ? deals : bought;
    const total = open.reduce((s, i) => s + (num(i.current_price) || 0), 0);
    $("#summary").textContent = tab === "list" ? `Kalan toplam (en ucuz fiyatlarla): ${tl(total)}` : tab === "bought" ? `Toplam harcanan: ${tl(bought.reduce((s, i) => s + (num(i.current_price) || 0), 0))}` : "";

    if (!list.length) {
      $("#items").innerHTML = `<div class="empty">${tab === "list" ? "Liste boş. Yukarıdan ilk linki ekle." : tab === "deals" ? "Şu an indirimde ürün yok." : "Henüz bir şey almadınız."}</div>`;
      return;
    }
    const groups = {};
    list.forEach((i) => (groups[i.category || "Genel"] ||= []).push(i));
    $("#items").innerHTML = Object.keys(groups).sort().map((c) => `<div class="cat">${esc(c)}</div>${groups[c].map(card).join("")}`).join("");
  }

  document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => {
    tab = b.dataset.tab;
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x === b));
    render();
  }));

  $("#addForm").onsubmit = async (e) => {
    e.preventDefault();
    const url = $("#fUrl").value.trim();
    const name = $("#fName").value.trim() || nameFromUrl(url) || "İsimsiz ürün";
    const isAk = /akakce\.com/i.test(url);
    const row = {
      name,
      source_url: url,
      akakce_url: isAk ? url : null,
      match_confirmed: isAk,
      category: $("#fCat").value.trim() || "Genel",
      target_price: $("#fTarget").value ? Number($("#fTarget").value) : null,
      added_by: getWho() || null,
    };
    const { error } = await db.from("items").insert(row);
    if (error) return alert("Eklenemedi: " + error.message);
    e.target.reset();
    load();
  };

  $("#items").onclick = async (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const id = b.dataset.id, act = b.dataset.act;
    let r;
    if (act === "buy") r = await db.from("items").update({ purchased: true, purchased_at: new Date().toISOString() }).eq("id", id);
    else if (act === "undo") r = await db.from("items").update({ purchased: false, purchased_at: null }).eq("id", id);
    else if (act === "ok") r = await db.from("items").update({ match_confirmed: true }).eq("id", id);
    else if (act === "fix") {
      const u = prompt("Doğru Akakçe ürün linkini yapıştır:");
      if (!u) return;
      if (!/akakce\.com/i.test(u)) return alert("Bu bir Akakçe linki değil.");
      r = await db.from("items").update({ akakce_url: u.trim(), match_confirmed: true, last_error: null, current_price: null, prev_price: null }).eq("id", id);
    } else if (act === "del") {
      if (!confirm("Bu ürün listeden silinsin mi?")) return;
      r = await db.from("items").delete().eq("id", id);
    }
    if (r && r.error) alert("Hata: " + r.error.message);
    load();
  };

  // ---- Manuel fiyat yenileme: GitHub Actions taramasını başlatır ----
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
    btn.textContent = "Taranıyor… (1-3 dk)";
    let tries = 0;
    const iv = setInterval(async () => {
      tries++;
      await load();
      if (lastCheck() > before || tries >= 16) {
        clearInterval(iv);
        btn.disabled = false; btn.textContent = "↻ Fiyatları yenile";
      }
    }, 15000);
  };

  db.channel("items").on("postgres_changes", { event: "*", schema: "public", table: "items" }, load).subscribe();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  load();
})();
