// 上書き保存ボタン / 取り込み時にファイル名を題名にする / PNG保存(共有シートが使えない環境ではダウンロード)
const { chromium } = require("playwright"); const path = require("path");
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ acceptDownloads: true }); const p = await ctx.newPage(); const errs = []; p.on("pageerror", e => errs.push(String(e)));
  let dialogs = 0; p.on("dialog", d => { dialogs++; d.accept(); });
  await p.goto("file://" + path.resolve(process.argv[2] || "index.html")); await p.waitForTimeout(400);
  let bad = 0; const ck = (ok, msg) => { if (!ok) bad++; console.log((ok ? "ok: " : "NG: ") + msg); };
  // 上書き保存: 未保存なら保存画面、保存済みなら確認なしで上書き
  await p.fill("#titleInput", "テスト曲"); await p.dispatchEvent("#titleInput", "input");
  await p.click("#overwriteBtn"); ck(await p.evaluate(() => document.getElementById("saveModal").classList.contains("show")), "未保存のとき: 保存画面が開く");
  await p.click("#saveOk"); await p.waitForTimeout(200);
  await p.evaluate(() => { state.score.bpm = 99; });
  await p.click("#overwriteBtn"); await p.waitForTimeout(200);
  const r = await p.evaluate(() => { const l = JSON.parse(localStorage.getItem(KEY_LIST)); return { n: l.length, bpm: l[0].bpm, modal: document.getElementById("saveModal").classList.contains("show") }; });
  ck(r.n === 1 && r.bpm === 99 && !r.modal && dialogs === 0, "保存済みのとき: 確認なしで上書き " + JSON.stringify(r) + " dialogs=" + dialogs);
  // 取り込み時の題名
  const t = await p.evaluate(() => {
    const out = [], run = (title, name) => { state.score = newScore(); if (title) state.score.title = title; omrToMeasures = () => [newMeasure()]; IMP.results = [{ res: {} }]; IMP.res = { bpm: 0 }; IMP.ts = "4/4"; IMP.file = { name }; document.querySelector('input[name="impMode"][value="replace"]').checked = true; applyImport(); out.push(state.score.title); };
    run(null, "忘れられないの-Drum Kit.pdf"); run(null, "嘘じゃない_Drum_Kit.pdf"); run("自分で付けた題", "別の曲.pdf"); run(null, "my song.png"); return out;
  });
  ck(JSON.stringify(t) === JSON.stringify(["忘れられないの", "嘘じゃない", "自分で付けた題", "my song"]), "ファイル名を題名に " + JSON.stringify(t));
  // PNG保存(PCではダウンロード)
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 8000 }).catch(() => null), p.click("#pngBtn")]);
  ck(!!dl && /\.png$/.test(dl.suggestedFilename()), "PNG保存: " + (dl && dl.suggestedFilename()));
  // PDF保存(A4・複数ページ)
  await p.evaluate(() => { const s = state.score; s.measures = []; for (let i = 0; i < 60; i++) { const m = newMeasure(); for (let t = 0; t < 192; t += 24) m.up.push({ t, d: 24, tup: false, i: ["hh_close"] }); m.down.push({ t: 0, d: 48, tup: false, i: ["kick"] }); s.measures.push(m); } renderAll(); });
  const [dp] = await Promise.all([p.waitForEvent("download", { timeout: 20000 }).catch(() => null), p.click("#pdfBtn")]);
  if (dp) { const path = await dp.path(), buf = require("fs").readFileSync(path), txt = buf.toString("latin1");
    ck(txt.startsWith("%PDF-1.4") && txt.includes("%%EOF"), "PDF保存: 形式 " + dp.suggestedFilename());
    const pages = (txt.match(/\/Type \/Page /g) || []).length; ck(pages >= 2 && pages <= 4, "PDF保存: 複数ページ " + pages);
    ck(txt.includes("/MediaBox [0 0 595.28 841.89]"), "PDF保存: A4"); } else ck(false, "PDFがダウンロードされない");
  // iPad想定: 共有シートでファイルを渡す
  await p.evaluate(() => { window.__shared = null; Object.defineProperty(navigator, "maxTouchPoints", { value: 5, configurable: true }); Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true }); navigator.canShare = () => true; navigator.share = async d => { window.__shared = d.files.map(f => f.name + ":" + f.type); }; });
  await p.click("#pngBtn"); await p.waitForTimeout(3000);
  const sh = await p.evaluate(() => window.__shared); ck(sh && /\.png:image\/png$/.test(sh[0]), "iPad想定: 共有シートにPNGを渡す " + JSON.stringify(sh));
  await p.evaluate(() => { window.__shared = null; }); await p.click("#pdfBtn"); await p.waitForTimeout(3000);
  const sh2 = await p.evaluate(() => window.__shared); ck(sh2 && /\.pdf:application\/pdf$/.test(sh2[0]), "iPad想定: 共有シートにPDFを渡す " + JSON.stringify(sh2));
  console.log(errs.length ? "ERRORS " + errs.join("|") : "no page errors"); if (bad || errs.length) process.exitCode = 1; else console.log("ALL PASSED"); await b.close();
})();
