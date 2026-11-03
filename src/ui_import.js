/* ===== ui_import.js : 画像・PDF・写真から楽譜を取り込む画面 =====
 * 画像(PNG/JPEG/写真)はそのまま、PDFは pdf.js(必要になった時だけ cdnjs から読み込む)で1ページを画像にして、
 * omr.js で読み取る。結果は「検出した位置」を元画像に重ねて確認してから、楽譜に取り込む。 */
const IMP = { results: [], res: null, ts: "4/4", file: null, pdf: null, page: 1, busy: false, lastCanvas: null };
const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const OMR_COLORS = { crash: "#f59e0b", hh_close: "#2563eb", hh_open: "#06b6d4", ride: "#8b5cf6", hi_tom: "#ec4899", snare: "#10b981", low_tom: "#f97316", kick: "#ef4444", hh_pedal: "#64748b" };

function openImport() { $("importModal").classList.add("show"); }
function impStatus(msg, err) { const e = $("impStatus"); e.textContent = msg; e.className = err ? "err-text" : "help"; }

function loadScriptOnce(url) {
  return new Promise((ok, ng) => {
    const s = document.createElement("script"); s.src = url; s.onload = ok; s.onerror = () => ng(new Error("読み込めませんでした"));
    document.head.appendChild(s);
  });
}
async function ensurePdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  await loadScriptOnce(PDFJS_URL);
  const r = await fetch(PDFJS_WORKER); const blob = new Blob([await r.text()], { type: "text/javascript" });   // 別サイトのworkerは直接使えないので一度取り込む
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
  return window.pdfjsLib;
}

/* ファイル → 画像(canvas) */
async function fileToCanvas(file, page) {
  if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
    let lib; try { lib = await ensurePdfJs(); } catch (e) { throw new Error("PDFを読む部品(pdf.js)を読み込めませんでした。通信できない環境です。PDFを画像(スクリーンショット)にして選んでください。"); }
    if (!IMP.pdf || IMP.pdfFile !== file) { IMP.pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise; IMP.pdfFile = file; }
    page = Math.max(1, Math.min(IMP.pdf.numPages, page || 1)); IMP.page = page;
    const pg = await IMP.pdf.getPage(page), vp0 = pg.getViewport({ scale: 1 }), sc = Math.min(3.2, 2300 / vp0.width), vp = pg.getViewport({ scale: sc });
    const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: g, viewport: vp }).promise; return c;
  }
  IMP.pdf = null;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ng(new Error("画像を開けませんでした(形式が対応していない可能性があります)")); i.src = url; });
    return imgToCanvas(img, img.naturalWidth, img.naturalHeight, 1);
  } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
}
function imgToCanvas(src, w, h, scale) {
  const W = Math.round(w * scale), H = Math.round(h * scale), c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); g.imageSmoothingQuality = "high"; g.drawImage(src, 0, 0, W, H); return c;
}

/* canvas → 読み取り。五線が小さすぎる時は拡大してやり直す */
function recognizeCanvas(c, ts) {
  const MAXD = 3200; let cv = c;
  if (Math.max(cv.width, cv.height) > MAXD) cv = imgToCanvas(cv, cv.width, cv.height, MAXD / Math.max(cv.width, cv.height));
  let res = null;
  for (let pass = 0; pass < 2; pass++) {
    const id = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height);
    res = omrRecognize(omrGray(id.data, cv.width, cv.height), cv.width, cv.height, { ts });
    if (!res.ok || res.S >= 9.5) break;
    const k = Math.min(3.5, 11.5 / res.S, MAXD / Math.max(cv.width, cv.height));
    if (k < 1.25) break;
    cv = imgToCanvas(cv, cv.width, cv.height, k);
  }
  return res;
}

/* 検出結果を元画像に重ねて表示 */
function drawPreview(res, label, keep) {
  const box = $("impPreview"); if (!keep) box.textContent = "";
  const full = document.createElement("canvas"); full.width = res.w; full.height = res.h;
  const g = full.getContext("2d"), im = g.createImageData(res.w, res.h);
  for (let i = 0; i < res.w * res.h; i++) { const v = res.gray[i]; im.data[4 * i] = im.data[4 * i + 1] = im.data[4 * i + 2] = v; im.data[4 * i + 3] = 255; }
  g.putImageData(im, 0, 0);
  res.systems.forEach(sy => {
    sy.barX.forEach(x => { g.strokeStyle = "#ef4444"; g.lineWidth = 2; g.beginPath(); g.moveTo(x, sy.st.lines[0] - 8); g.lineTo(x, sy.st.lines[4] + 8); g.stroke(); });
    sy.heads.forEach(q => { g.strokeStyle = OMR_COLORS[q.inst] || "#000"; g.lineWidth = Math.max(2, res.S * 0.18); const r = res.S * 0.62; g.strokeRect(q.x - r, q.y - r, 2 * r, 2 * r); });
  });
  res.systems.forEach((sy, i) => {
    const y0 = Math.max(0, Math.round(sy.st.lines[0] - res.S * 5.5)), y1 = Math.min(res.h, Math.round(sy.st.lines[4] + res.S * 5)), x0 = Math.max(0, Math.round(sy.st.left - 10)), x1 = Math.min(res.w, Math.round(sy.st.right + 10));
    const c = document.createElement("canvas"); c.width = x1 - x0; c.height = y1 - y0; c.getContext("2d").drawImage(full, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
    c.style.cssText = "width:100%;height:auto;display:block;background:#fff;border-radius:4px";
    const cap = document.createElement("div"); cap.className = "help"; cap.textContent = `${label || ""}${i + 1}段目`;
    box.append(cap, c);
  });
}

async function runImport() {
  if (IMP.busy || !IMP.file) return; IMP.busy = true; $("impApply").disabled = true; $("impPreview").textContent = ""; IMP.results = []; IMP.res = null;
  try {
    impStatus("読み取り中…(数秒かかります)");
    await new Promise(r => setTimeout(r, 30));
    let c = await fileToCanvas(IMP.file, IMP.page);
    const isPdf = !!IMP.pdf, all = isPdf && $("impAll").checked, total = isPdf ? IMP.pdf.numPages : 1;
    $("impAllWrap").style.display = isPdf ? "inline-flex" : "none"; $("impPage").style.display = isPdf && !all ? "flex" : "none";
    if (isPdf && !all) $("impPageInfo").textContent = `${IMP.page} / ${total} ページ`;
    const pages = all ? Array.from({ length: total }, (_, i) => i + 1) : [IMP.page]; let ts = IMP.ts, skipped = [];
    for (let k = 0; k < pages.length; k++) {
      const pn = pages[k];
      if (all) { impStatus(`読み取り中… ${pn} / ${total} ページ`); await new Promise(r => setTimeout(r, 30)); if (k > 0 || pn !== IMP.page) c = await fileToCanvas(IMP.file, pn); }
      const res = recognizeCanvas(c, ts); c = null;
      if (!res.ok || !omrCount(res)) { skipped.push(pn); if (!all) { impStatus(res.ok ? "五線は見つかりましたが、音符を検出できませんでした。明るく、まっすぐ、大きく撮影してお試しください。" : res.error, true); if (res.ok) drawPreview(res); } continue; }
      drawPreview(res, all ? `${pn}ページ ` : "", IMP.results.length > 0);
      res.gray = null; IMP.results.push({ page: pn, res });
      const last = res.measures[res.measures.length - 1]; if (last && last.ts) ts = last.ts;     // 次のページへ拍子を引き継ぐ
    }
    if (!IMP.results.length) { if (all) impStatus("どのページからも楽譜を検出できませんでした。", true); return; }
    IMP.res = IMP.results[0].res;
    const nm = IMP.results.reduce((a, r) => a + r.res.measures.reduce((x, m) => x + (m.mrN >= 2 ? m.mrN : 1), 0), 0), nn = IMP.results.reduce((a, r) => a + omrCount(r.res), 0);
    const r0 = IMP.results[0].res;
    impStatus(`${all ? IMP.results.length + "ページ・" : ""}${r0.systems.length}段${all ? "(最初のページ)" : ""}・${nm}小節・${nn}個の音符を検出しました${all ? "" : "(傾き補正 " + r0.skew.toFixed(1) + "°)"}${r0.bpm ? "・テンポ" + r0.bpm : ""}。${skipped.length ? "楽譜が見つからなかったページ: " + skipped.join(",") + "。" : ""}下の画像で、色つきの四角が検出位置です。取り込み後に手直ししてください。`);
    $("impApply").disabled = false;
  } catch (e) { IMP.res = null; IMP.results = []; impStatus("読み取りに失敗しました: " + e.message, true); console.error(e); }
  finally { IMP.busy = false; }
}

function applyImport() {
  if (!IMP.results || !IMP.results.length) return;
  const ms = []; IMP.results.forEach(r => ms.push(...omrToMeasures(r.res, IMP.ts))); if (!ms.length) { impStatus("取り込める小節がありません", true); return; }
  const mode = document.querySelector('input[name="impMode"]:checked').value;
  Player.stop(); hidePlayhead();
  if (mode === "replace") state.score.measures = ms; else state.score.measures.push(...ms);
  state.cursor = { m: mode === "replace" ? 0 : state.score.measures.length - ms.length, t: 0 }; state.anchor = null;
  if (mode === "replace" && IMP.res.bpm >= 30 && IMP.res.bpm <= 300) state.score.bpm = Math.max(40, Math.min(240, IMP.res.bpm));
  commit(); closeModal("importModal");
  showStatus(`${ms.length}小節を取り込みました${mode === "replace" && IMP.res.bpm ? "(テンポ" + IMP.res.bpm + ")" : ""}。「↩ 戻す」で取り込み前に戻せます`);
}

function bindImport() {
  const on = (id, ev, fn) => $(id).addEventListener(ev, fn);
  on("importBtn", "click", openImport);
  on("impFile", "change", e => { const f = e.target.files && e.target.files[0]; if (!f) return; IMP.file = f; IMP.page = 1; IMP.pdf = null; $("impName").textContent = f.name; runImport(); e.target.value = ""; });
  on("impAll", "change", () => { if (IMP.file) runImport(); });
  on("impTs", "change", e => { IMP.ts = e.target.value; if (IMP.file) runImport(); });
  on("impPrev", "click", () => { if (IMP.page > 1) { IMP.page--; runImport(); } });
  on("impNext", "click", () => { if (IMP.pdf && IMP.page < IMP.pdf.numPages) { IMP.page++; runImport(); } });
  on("impApply", "click", applyImport);
  const drop = $("impDrop");
  ["dragover", "dragenter"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", e => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) { IMP.file = f; IMP.page = 1; IMP.pdf = null; $("impName").textContent = f.name; runImport(); } });
  document.addEventListener("paste", e => {                         // コピーした画像を貼り付け
    if (!$("importModal").classList.contains("show")) return;
    const it = [...(e.clipboardData ? e.clipboardData.items : [])].find(i => /^image\//.test(i.type)); if (!it) return;
    IMP.file = it.getAsFile(); IMP.page = 1; IMP.pdf = null; $("impName").textContent = "貼り付けた画像"; runImport();
  });
}

/* ===== 録音した音(サンプル)の画面 ===== */
function smpRender() {
  const box = $("smpList"); box.textContent = "";
  Object.keys(INSTRUMENTS).forEach(k => {
    const l = SAMPLES.kit[k] || [], row = document.createElement("div"); row.className = "list-row";
    const nm = document.createElement("span"); nm.textContent = INSTRUMENTS[k].name + "  " + (l.length ? l.length + "個" : "(合成音)"); nm.style.color = l.length ? "#6ee7b7" : "";
    const lab = document.createElement("label"); lab.className = "filebtn"; lab.style.cssText = "padding:6px 12px;font-size:.8rem"; lab.textContent = "選ぶ";
    const inp = document.createElement("input"); inp.type = "file"; inp.multiple = true; inp.accept = "audio/*,.wav,.mp3,.m4a,.ogg,.flac"; inp.style.display = "none";
    inp.addEventListener("change", async e => { await smpLoad(e.target.files, k); e.target.value = ""; }); lab.appendChild(inp);
    const del = document.createElement("button"); del.className = "small"; del.textContent = "外す"; del.disabled = !l.length; del.addEventListener("click", () => { clearSamples(k); smpRender(); });
    row.append(nm, lab, del); box.appendChild(row);
  });
  const mb = (sampleBytes() / 1048576).toFixed(1);
  $("smpStatus").textContent = sampleBytes() ? `読み込み済み: ${mb}MB。` + (SAMPLES.persisted ? "次回から自動で使います(このブラウザに保存)。" : "この環境では保存できないため、今回だけ有効です。") : "";
  $("sampleBtn").textContent = Object.keys(SAMPLES.kit).length ? "🥁 録音した音を使う(設定済み)" : "🥁 録音した音を使う";
}
async function smpLoad(files, inst) {
  if (!files || !files.length) return; $("smpStatus").textContent = "読み込み中…";
  const r = await loadSampleFiles([...files], inst); smpRender();
  const sum = Object.entries(r.added).map(([k, n]) => INSTRUMENTS[k].name + " " + n + "個").join("、");
  $("smpStatus").textContent += ` ${sum ? "追加: " + sum + "。" : ""}${r.skipped.length ? " 使えなかったファイル: " + r.skipped.slice(0, 6).join(" / ") : ""}`;
}
function bindSamples() {
  $("sampleBtn").addEventListener("click", () => { smpRender(); $("sampleModal").classList.add("show"); });
  $("smpBulk").addEventListener("change", async e => { await smpLoad(e.target.files, null); e.target.value = ""; });
  $("smpOn").addEventListener("change", e => { SAMPLES.on = e.target.checked; });
  $("smpClear").addEventListener("click", () => { if (confirm("読み込んだ録音の音をすべて外して、合成音に戻しますか？")) { clearSamples(); smpRender(); } });
  samplesRestore().then(n => { if (n) { smpRender(); showStatus(`録音した音(${n}個)を読み込みました`); } });
}
