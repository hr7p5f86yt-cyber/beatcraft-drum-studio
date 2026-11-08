/* ===== ui_io.js : 保存・読み込み・書き出し・自己テスト・初期化 ===== */
const KEY_LATEST = "beatcraft_latest", KEY_LIST = "beatcraft_scores";
let storageWarned = false, saveTimer = 0;

function storageGet(k) { try { return { ok: true, value: localStorage.getItem(k) }; } catch (e) { return { ok: false, error: e.message }; } }
function storageSet(k, v) { try { localStorage.setItem(k, v); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } }
/* 最新版の確認と更新: 公開ページを「キャッシュなし」で取りにいき、版番号が違えば読み込み直す(楽譜は自動保存してから) */
async function checkUpdate() {
  const msg = $("updateMsg"), btn = $("updateBtn"), cur = (document.querySelector(".badge") || {}).textContent || "";
  const say = t => { if (msg) msg.textContent = " " + t; showStatus(t); };
  if (location.protocol === "file:") { say("この環境(ファイル直開き)では更新確認できません"); return; }
  btn.disabled = true; say("最新版を確認しています…");
  try {
    const base = location.href.split("#")[0].split("?")[0];
    const res = await fetch(base + "?chk=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const m = (await res.text()).match(/class="badge">([^<]+)</), latest = m ? m[1].trim() : "";
    if (!latest) throw new Error("版番号が見つかりません");
    if (latest === cur.trim()) { say("最新版です(" + cur.trim() + ")"); btn.disabled = false; return; }
    say("新しい版 " + latest + " を読み込みます…"); autoSave();
    try { if (window.caches) { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); } } catch (e) { /* 無くても更新はできる */ }
    setTimeout(() => location.replace(base + "?v=" + encodeURIComponent(latest) + "&t=" + Date.now()), 400);
  } catch (e) { say("更新確認に失敗しました(" + e.message + ")。通信を確認してもう一度お試しください"); btn.disabled = false; }
}
function autoSave() {
  const r = storageSet(KEY_LATEST, JSON.stringify(state.score));
  if (!r.ok && !storageWarned) {
    storageWarned = true; $("storageBanner").style.display = "block";
    showStatus("自動保存できません: " + r.error + "。「開く」画面のバックアップ(テキスト)をご利用ください", "err");
  }
}
function autoSaveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(autoSave, 300); }

/* 保存リストを読む。壊れている時は上書きしないよう ok:false を返す */
function readList() {
  const g = storageGet(KEY_LIST); if (!g.ok) return { ok: false, error: g.error };
  if (!g.value) return { ok: true, list: [] };
  try { const l = JSON.parse(g.value); if (!Array.isArray(l)) throw new Error("形式が違います"); return { ok: true, list: l }; }
  catch (e) { return { ok: false, error: "保存リストが壊れています: " + e.message }; }
}

/* 上書き保存: 今のタイトルが保存リストにあれば、確認なしでそのまま保存。なければ「保存」画面を開く */
function overwriteSave() {
  const title = (state.score.title || "").trim(); if (!title) { openSaveModal(); return; }
  const rl = readList(); if (!rl.ok) { showStatus("保存できません: " + rl.error, "err"); return; }
  const idx = rl.list.findIndex(s => s && s.title === title); if (idx < 0) { openSaveModal(); return; }
  rl.list[idx] = JSON.parse(JSON.stringify(state.score));
  const w = storageSet(KEY_LIST, JSON.stringify(rl.list));
  if (!w.ok) { showStatus("保存に失敗しました: " + w.error + "(バックアップ機能をお使いください)", "err"); return; }
  autoSave(); showStatus(`「${title}」を上書き保存しました`);
}
function openSaveModal() { $("saveTitleInput").value = state.score.title; $("saveModal").classList.add("show"); }
function executeSave() {
  const title = $("saveTitleInput").value.trim() || "マイ・ドラム・スコア";
  const rl = readList(); if (!rl.ok) { showStatus("保存できません: " + rl.error, "err"); return; }
  const idx = rl.list.findIndex(s => s && s.title === title);
  if (idx >= 0 && !confirm(`「${title}」はすでに保存されています。上書きしますか？`)) return;
  state.score.title = title;
  const copy = JSON.parse(JSON.stringify(state.score));
  if (idx >= 0) rl.list[idx] = copy; else rl.list.push(copy);
  const w = storageSet(KEY_LIST, JSON.stringify(rl.list));
  if (!w.ok) { showStatus("保存に失敗しました: " + w.error + "(バックアップ機能をお使いください)", "err"); return; }
  closeModal("saveModal"); renderAll(); autoSave(); showStatus(`「${title}」を保存しました`);
}

function openLoadModal() {
  const box = $("loadList"); box.textContent = "";
  const rl = readList();
  if (!rl.ok) { const p = document.createElement("p"); p.className = "err-text"; p.textContent = rl.error; box.appendChild(p); }
  else if (rl.list.length === 0) { const p = document.createElement("p"); p.className = "sub"; p.textContent = "保存された楽譜はありません。"; box.appendChild(p); }
  else rl.list.forEach((item, i) => {
    const row = document.createElement("div"); row.className = "list-row";
    const name = document.createElement("span"); name.textContent = "🎵 " + String(item && item.title || "(無題)");
    const open = document.createElement("button"); open.className = "primary small"; open.textContent = "開く";
    open.addEventListener("click", () => { if (loadScore(item)) closeModal("loadModal"); });
    const del = document.createElement("button"); del.className = "danger small"; del.textContent = "削除";
    del.addEventListener("click", () => {
      if (!confirm("この保存データを削除しますか？")) return;
      const cur = readList(); if (!cur.ok) { showStatus(cur.error, "err"); return; }
      cur.list.splice(i, 1); const w = storageSet(KEY_LIST, JSON.stringify(cur.list));
      if (!w.ok) showStatus("削除に失敗しました: " + w.error, "err"); else openLoadModal();
    });
    row.append(name, open, del); box.appendChild(row);
  });
  $("loadModal").classList.add("show");
}

/* 読み込み: 検証に失敗したら今の楽譜を変えない */
function loadScore(raw) {
  const r = migrateScore(raw);
  if (!r.ok) { showStatus(r.error, "err"); return false; }
  Player.stop(); state.score = r.score; resetHistory(); Player.rebuild(state.score); renderAll(); autoSave();
  showStatus(`「${state.score.title}」を開きました`); return true;
}
function backupExport() { $("backupText").value = JSON.stringify(state.score, null, 1); $("backupText").select(); }
function backupCopy() {
  const t = $("backupText"); if (!t.value) backupExport();
  const done = () => showStatus("コピーしました");
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t.value).then(done, () => { t.select(); showStatus("自動コピーできません。選択済みの文字を手動でコピーしてください", "err"); });
  else { t.select(); showStatus("自動コピーできません。選択済みの文字を手動でコピーしてください", "err"); }
}
function backupImport() {
  const txt = $("backupText").value.trim(); if (!txt) { showStatus("読み込むテキストを貼り付けてください", "err"); return; }
  let raw; try { raw = JSON.parse(txt); } catch (e) { showStatus("JSONとして読めません: " + e.message, "err"); return; }
  if (confirm("今の楽譜を、貼り付けた内容に置き換えますか？")) { if (loadScore(raw)) closeModal("loadModal"); }
}
function fileImport(ev) {
  const file = ev.target.files && ev.target.files[0]; if (!file) return;
  const fr = new FileReader();
  fr.onload = () => { $("backupText").value = String(fr.result); backupImport(); ev.target.value = ""; };
  fr.onerror = () => showStatus("ファイルを読めませんでした", "err");
  fr.readAsText(file);
}

/* ---- 書き出し ---- */
function downloadBlob(blob, name) {
  const a = document.createElement("a"), url = URL.createObjectURL(blob);
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function safeName() { return (state.score.title || "score").replace(/[\\/:*?"<>|]/g, "_"); }
function exportSvg() {
  try { downloadBlob(new Blob([scoreToSvgDocument(state.score)], { type: "image/svg+xml;charset=utf-8" }), safeName() + ".svg"); showStatus("SVGを保存しました"); }
  catch (e) { showStatus("SVG保存に失敗しました: " + e.message, "err"); }
}
/* iPad/iPhone: ダウンロードだと別ページが開いて手順が多いので、共有シートから「画像を保存」を直接選べるようにする。使えない/やめたときは通常のダウンロード */
function isTouchApple() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }
async function savePngBlob(blob) {
  const name = safeName() + ".png";
  try {
    const f = new File([blob], name, { type: "image/png" });
    if (isTouchApple() && navigator.canShare && navigator.canShare({ files: [f] })) {
      try { await navigator.share({ files: [f], title: state.score.title || "楽譜" }); showStatus("共有メニューで「画像を保存」を選ぶと、写真に保存できます"); return; }
      catch (e) { if (e && e.name === "AbortError") return; /* 共有できないときは下のダウンロードへ */ }
    }
  } catch (e) { /* ダウンロードへ */ }
  downloadBlob(blob, name); showStatus("PNGを保存しました");
}
function exportPng() {
  try {
    const svg = scoreToSvgDocument(state.score), r = state.view, img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas"); c.width = r.width * 2; c.height = r.height * 2;
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(b => { if (!b) { showStatus("PNG変換に失敗しました。SVG保存をお試しください", "err"); return; } savePngBlob(b); }, "image/png");
      } catch (e) { showStatus("PNG出力に失敗しました: " + e.message + "(SVG保存をお試しください)", "err"); }
    };
    img.onerror = () => showStatus("PNG出力に失敗しました。SVG保存をお試しください", "err");
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  } catch (e) { showStatus("PNG出力に失敗しました: " + e.message, "err"); }
}
/* ---- A4 の複数ページ PDF(外部ライブラリなし: 各ページを画像にして PDF に並べる) ---- */
const PDF_PAGE = { W: 595.28, H: 841.89, PX: 2100 };
function pdfPaginate(lay) {
  // 段(sysTop が同じ小節のまとまり)ごとに、1ページに入るだけ積む。段の途中では切らない
  const L = LAYOUT, pageH = L.PAGE_W * PDF_PAGE.H / PDF_PAGE.W, top = 36, bottom = 40, usable = pageH - top - bottom;
  const rows = []; lay.measures.forEach(m => { if (m.hidden) return; if (!rows.length || rows[rows.length - 1].top !== m.sysTop) rows.push({ top: m.sysTop, bottom: m.sysBottom + L.ROW_GAP / 2 }); });
  const pages = []; let cur = null;
  rows.forEach((r, i) => {
    const y0 = i === 0 ? 0 : r.top - L.ROW_GAP / 2;                                    // 1段目は題名の分も含める
    if (!cur || r.bottom - cur.y0 > (pages.length === 0 ? usable : usable)) { cur = { y0: i === 0 ? 0 : y0, y1: r.bottom }; pages.push(cur); }
    else cur.y1 = r.bottom;
  });
  if (!pages.length) pages.push({ y0: 0, y1: lay.height });
  pages[pages.length - 1].y1 = Math.max(pages[pages.length - 1].y1, Math.min(lay.height, pages[pages.length - 1].y1 + 20));
  return { pages, pageH, top, bottom };
}
function buildPdfBytes(jpegs) {                                                       // jpegs: [{bytes, w, h}]
  const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
  const push = d => { const u = typeof d === "string" ? enc.encode(d) : d; parts.push(u); len += u.length; };
  const obj = (n, body) => { offs[n] = len; push(n + " 0 obj\n"); if (typeof body === "string") push(body); else body.forEach(push); push("\nendobj\n"); };
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const N = jpegs.length, kids = jpegs.map((_, i) => (3 + i * 3) + " 0 R").join(" ");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [" + kids + "] /Count " + N + " >>");
  jpegs.forEach((j, i) => {
    const pn = 3 + i * 3, cn = pn + 1, im = pn + 2, cs = "q " + PDF_PAGE.W + " 0 0 " + PDF_PAGE.H + " 0 0 cm /Im0 Do Q";
    obj(pn, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + PDF_PAGE.W + " " + PDF_PAGE.H + "] /Resources << /XObject << /Im0 " + im + " 0 R >> >> /Contents " + cn + " 0 R >>");
    obj(cn, "<< /Length " + cs.length + " >>\nstream\n" + cs + "\nendstream");
    obj(im, ["<< /Type /XObject /Subtype /Image /Width " + j.w + " /Height " + j.h + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + j.bytes.length + " >>\nstream\n", j.bytes, "\nendstream"]);
  });
  const xr = len, total = 3 + N * 3;
  push("xref\n0 " + total + "\n0000000000 65535 f \n");
  for (let n = 1; n < total; n++) push(String(offs[n]).padStart(10, "0") + " 00000 n \n");
  push("trailer\n<< /Size " + total + " /Root 1 0 R >>\nstartxref\n" + xr + "\n%%EOF\n");
  const out = new Uint8Array(len); let p = 0; parts.forEach(u => { out.set(u, p); p += u.length; }); return out;
}
async function pdfPages() {
  const r = buildScoreSvg(state.score), svg = scoreToSvgDocument(state.score);
  const img = await new Promise((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ng(new Error("画像化できませんでした")); i.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); });
  const pg = pdfPaginate(r.layout), W = PDF_PAGE.PX, k = W / LAYOUT.PAGE_W, H = Math.round(W * PDF_PAGE.H / PDF_PAGE.W), out = [];
  for (let i = 0; i < pg.pages.length; i++) {
    const P = pg.pages[i], c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
    const sh = Math.min(P.y1, r.height) - P.y0;
    g.drawImage(img, 0, P.y0, LAYOUT.PAGE_W, sh, 0, pg.top * k, W, sh * k);
    g.fillStyle = "#777"; g.font = Math.round(9 * k) + "px sans-serif"; g.textBaseline = "alphabetic";
    g.textAlign = "left"; g.fillText((state.score.title || "") + "  -  BeatCraft Drum Studio", LAYOUT.MARGIN * k, H - 16 * k);
    g.textAlign = "right"; g.fillText((i + 1) + " / " + pg.pages.length, (LAYOUT.PAGE_W - LAYOUT.MARGIN) * k, H - 16 * k);
    const url = c.toDataURL("image/jpeg", 0.95), bin = atob(url.slice(url.indexOf(",") + 1)), bytes = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
    out.push({ bytes, w: W, h: H });
  }
  return out;
}
async function exportPdf() {
  try {
    showStatus("PDFを作っています…");
    const bytes = buildPdfBytes(await pdfPages()), name = safeName() + ".pdf", blob = new Blob([bytes], { type: "application/pdf" });
    try {
      const f = new File([blob], name, { type: "application/pdf" });
      if (isTouchApple() && navigator.canShare && navigator.canShare({ files: [f] })) {
        try { await navigator.share({ files: [f], title: state.score.title || "楽譜" }); showStatus("共有メニューで「“ファイル”に保存」を選ぶと保存できます"); return; }
        catch (e) { if (e && e.name === "AbortError") return; }
      }
    } catch (e) { /* ダウンロードへ */ }
    downloadBlob(blob, name); showStatus("PDFを保存しました(A4・" + Math.ceil(bytes.length / 1024) + "KB)");
  } catch (e) { showStatus("PDF出力に失敗しました: " + e.message + "(PNG保存をお試しください)", "err"); }
}
function printScore() {
  try { window.print(); } catch (e) { showStatus("印刷を開始できません: " + e.message + "(SVG/PNG保存をお試しください)", "err"); }
}

/* ---- 自己テスト ---- */
function runSelfTest() {
  const res = [], t = (name, fn) => { try { const r = fn(); res.push([name, r === true, r === true ? "" : String(r)]); } catch (e) { res.push([name, false, e.message]); } };
  t("4/4 を 120BPM で再生すると 1小節=2.0秒", () => { const s = 60 / 120 / TPQ * tsInfo("4/4").ticks; return Math.abs(s - 2) < 1e-9 || s; });
  t("6/8 を 120BPM で再生すると 1小節=1.5秒", () => { const s = 60 / 120 / TPQ * tsInfo("6/8").ticks; return Math.abs(s - 1.5) < 1e-9 || s; });
  t("保存→読み込みで同じデータに戻る", () => { const a = JSON.stringify(state.score), r = migrateScore(JSON.parse(a)); return (r.ok && JSON.stringify(r.score) === a) || "不一致"; });
  t("各小節で、休符を含む声部の長さ合計=小節の長さ", () => {
    for (const m of state.score.measures) for (const v of ["up", "down"]) {
      const info = tsInfo(m.ts), sum = fillRests(m[v], info.ticks, info.beat).reduce((a, e) => a + e.d, 0);
      if (sum !== info.ticks) return `${m.ts} ${v}: ${sum}/${info.ticks}`;
    } return true;
  });
  t("旧形式(v5)のデータを変換できる", () => { const r = migrateScore({ version: "5.1.0", measures: [{ timeSignature: "4/4", notes: { 0: [{ inst: "kick", duration: 24 }] } }] }); return (r.ok && r.score.measures[0].down.length === 1) || "変換失敗"; });
  t("壊れたデータは拒否され、今の楽譜は変わらない", () => { const before = JSON.stringify(state.score), r = migrateScore({ x: 1 }); return (!r.ok && JSON.stringify(state.score) === before) || "拒否されない"; });
  t("段組みが用紙幅に収まる", () => { const L = layoutScore(state.score); return L.measures.every(m => m.x0 + m.w <= LAYOUT.PAGE_W - LAYOUT.MARGIN + 1) || "はみ出し"; });
  t("位置→tick の変換が往復で一致する", () => {
    const L = layoutScore(state.score);
    for (const it of L.measures) for (const k of [0, 12, 24, 48, 96]) { if (it.hidden || !it.ppt || k >= it.ticks) continue; const x = it.xStart + LAYOUT.HEAD_OFF + k * it.ppt; if (Math.round((x - it.xStart - LAYOUT.HEAD_OFF) / it.ppt) !== k) return "ずれ"; }
    return true;
  });
  t("強弱記号と繰り返しを含む楽譜が保存→読込で同じになる", () => {
    const sc = newScore(); setDynamic(sc.measures[0], 0, "p"); setHairpin(sc.measures[0], 0, 192, "c"); sc.measures[1].rs = true; sc.measures[2].re = true;
    toggleNote(sc.measures[0], "snare", 0, 24, false); sc.measures[0].up[0].acc = true;
    const a = JSON.stringify(sc), r = migrateScore(JSON.parse(a)); return (r.ok && JSON.stringify(r.score) === a) || "不一致";
  });
  t("音の合成: 全パーツ・全強さで波形を作れる", () => {
    for (const k of Object.keys(INSTRUMENTS)) for (let l = 0; l < DRUM_LAYERS.length; l++) { const w = waveFor(k, l, 0); if (!w.length || !isFinite(w[5])) return k + " " + l; }
    return true;
  });
  t("ブラウザの保存領域(localStorage)が使える", () => { const w = storageSet("beatcraft_test", "1"); if (!w.ok) return w.error; try { localStorage.removeItem("beatcraft_test"); } catch (e) { return e.message; } return true; });
  const box = $("testList"); box.textContent = "";
  res.forEach(([n, ok, d]) => { const row = document.createElement("div"); row.className = "list-row"; row.textContent = (ok ? "✅ " : "❌ ") + n + (d ? ` — ${d}` : ""); box.appendChild(row); });
  const p = document.createElement("p"); p.className = res.every(r => r[1]) ? "sub" : "err-text";
  p.textContent = res.every(r => r[1]) ? "すべて合格です" : "不合格の項目があります"; box.appendChild(p);
  $("testModal").classList.add("show");
}

/* ---- 初期化 ---- */
function buildPalette() {
  const pal = $("palette");
  Object.keys(INSTRUMENTS).forEach((k, n) => {
    const b = document.createElement("button"); b.className = "drum-btn"; b.dataset.inst = k; b.style.background = INSTRUMENTS[k].color;
    const letter = Object.keys(INST_KEYS).find(x => INST_KEYS[x] === k).toUpperCase();
    b.textContent = INSTRUMENTS[k].name + " (" + letter + ")"; b.title = `キーボード: ${letter}(カーソル位置に入力)`;
    b.addEventListener("click", () => { state.inst = k; state.mode = "input"; updateButtons(); }); pal.appendChild(b);
  });
}
function bindEvents() {
  const on = (id, ev, fn) => $(id).addEventListener(ev, fn);
  on("scoreHost", "click", onScoreClick);
  on("playBtn", "click", togglePlay); on("stopBtn", "click", stopPlay); on("loopBtn", "click", toggleLoop);
  on("undoBtn", "click", undo); on("redoBtn", "click", redo); on("clearBtn", "click", clearAllNotes); on("newBtn", "click", newBlankScore); on("simNotesChk", "change", toggleSimStyle); on("voiceBtn", "click", cycleVoice);
  on("bpmRange", "input", e => changeBpm(e.target.value));
  on("subtitleInput", "change", e => { state.score.subtitle = e.target.value.trim().slice(0, 80); commit(); });
  on("composerInput", "change", e => { state.score.composer = e.target.value.trim().slice(0, 80); commit(); });
  on("titleInput", "change", e => { state.score.title = e.target.value.trim().slice(0, 80) || "マイ・ドラム・スコア"; commit(); });
  document.querySelectorAll("[data-base]").forEach(b => b.addEventListener("click", () => setBase(+b.dataset.base)));
  on("dotBtn", "click", () => { state.dotted = !state.dotted; if (state.dotted) state.tuplet = false; updateButtons(); drawOverlay(); });
  on("tupBtn", "click", () => { state.tuplet = !state.tuplet; if (state.tuplet) state.dotted = false; updateButtons(); drawOverlay(); });
  on("modeInput", "click", () => { state.mode = "input"; updateButtons(); });
  on("modeSelect", "click", () => { state.mode = "select"; updateButtons(); });
  document.querySelectorAll("[data-dyn]").forEach(b => b.addEventListener("click", () => applyDynamic(b.dataset.dyn)));
  on("hpCresc", "click", () => applyHairpin("c")); on("hpDim", "click", () => applyHairpin("d")); on("clearMarks", "click", clearMarksHere);
  on("accBtn", "click", () => applyFlag("acc", "アクセント")); on("ghostBtn", "click", () => applyFlag("gh", "ゴースト")); on("flamBtn", "click", () => applyFlag("fl", "フラム")); on("dragBtn", "click", () => applyFlag("dr", "ドラッグ"));
  on("beamBtn", "click", applyBeam); on("tupConvBtn", "click", () => applyTuplet("to")); on("tupOffBtn", "click", () => applyTuplet("from"));
  on("simBtn", "click", toggleSimHere); on("autoSimBtn", "click", applyAutoSim); on("autoMrBtn", "click", applyAutoMr);
  on("helpBtn", "click", openHelp);
  on("updateBtn", "click", checkUpdate);
  on("autoAdvance", "change", e => { state.auto = e.target.checked; });
  on("followChk", "change", e => { state.follow = e.target.checked; updateButtons(); });
  on("exprChk", "change", e => { AUDIO_OPT.expr = e.target.checked; Player.rebuild(state.score); });
  on("humanize", "change", e => { AUDIO_OPT.humanize = e.target.checked; });
  on("roomRange", "input", e => setRoom(e.target.value / 100));
  on("modeErase", "click", () => { state.mode = "erase"; updateButtons(); });
  on("addMeasureBtn", "click", addMeasure); on("delMeasureBtn", "click", removeLastMeasure);
  on("saveBtn", "click", openSaveModal); on("overwriteBtn", "click", overwriteSave); on("loadBtn", "click", openLoadModal); on("saveOk", "click", executeSave);
  on("svgBtn", "click", exportSvg); on("pngBtn", "click", exportPng); on("pdfBtn", "click", exportPdf); on("printBtn", "click", printScore); on("testBtn", "click", runSelfTest);
  on("measureOk", "click", applyMeasureModal); on("measureInsert", "click", insertMeasureAfter);
  on("measureClear", "click", clearMeasure); on("measureDelete", "click", deleteMeasure);
  on("backupExport", "click", backupExport); on("backupCopy", "click", backupCopy); on("backupImport", "click", backupImport);
  on("fileInput", "change", fileImport);
  on("fileSave", "click", () => { try { downloadBlob(new Blob([JSON.stringify(state.score, null, 1)], { type: "application/json" }), safeName() + ".json"); } catch (e) { showStatus("ファイル保存に失敗: " + e.message, "err"); } });
  document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => closeModal(b.dataset.close)));
  bindImport(); bindSamples();
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && Player.playing) { Player.pause(); hidePlayhead(); updateButtons(); showStatus("画面が見えなくなったため一時停止しました"); }
  });
}
function fillTsOptions() {                       // 拍子の選択肢は TIME_SIGS から作る
  ["tsSelect", "impTs"].forEach(id => { const sel = $(id); if (!sel) return; sel.textContent = ""; Object.keys(TIME_SIGS).forEach(k => { const o = document.createElement("option"); o.value = k; o.textContent = k; sel.appendChild(o); }); sel.value = "4/4"; });
}
function init() {
  fillTsOptions(); buildPalette(); buildDock(); bindEvents();
  const g = storageGet(KEY_LATEST);
  if (!g.ok) { $("storageBanner").style.display = "block"; storageWarned = true; }
  else if (g.value) {
    try { const r = migrateScore(JSON.parse(g.value)); if (r.ok) state.score = r.score; else { storageSet(KEY_LATEST + "_corrupt", g.value); showStatus(r.error + "(新しい楽譜で開始します)", "err"); } }
    catch (e) { storageSet(KEY_LATEST + "_corrupt", g.value); showStatus("自動保存データを読めませんでした(新しい楽譜で開始します)", "err"); }
  }
  resetHistory(); Player.rebuild(state.score); renderAll(); prewarmWaves();
}
window.addEventListener("DOMContentLoaded", init);
