// PDFの全ページ取り込みのテスト(pdf.js は同じ呼び口の代用品で置き換える)
const { chromium } = require("playwright"); const path = require("path");
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1180, height: 820 } }); const errs = []; let bad = 0;
  p.on("pageerror", e => errs.push(String(e))); const ok = (c, m) => { console.log((c ? "ok: " : "NG: ") + m); if (!c) bad++; };
  await p.goto("file://" + path.resolve(process.argv[2] || "index.html")); await p.waitForTimeout(300);
  const r = await p.evaluate(async () => {
    const mk = (n, seed) => { const sc = newScore(); sc.measures = []; for (let i = 0; i < n; i++) { const m = newMeasure("4/4"); for (let t = 0; t < 192; t += 24) toggleNote(m, "hh_close", t, 24, false); toggleNote(m, "snare", 48, 24, false); toggleNote(m, "snare", 144, 24, false); toggleNote(m, "kick", 0, 24, false); if ((i + seed) % 2) toggleNote(m, "kick", 96, 24, false); sc.measures.push(m); } return sc; };
    const toImg = url => new Promise((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ng; i.src = url; });
    const pagesSc = [mk(8, 0), mk(4, 1), newScore()];                  // 3ページ目は楽譜なし(空)
    pagesSc[2].measures = [];
    const imgs = []; for (const sc of pagesSc) imgs.push(sc.measures.length ? await toImg("data:image/svg+xml;charset=utf-8," + encodeURIComponent(scoreToSvgDocument(sc))) : null);
    window.pdfjsLib = { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve({ numPages: 3, getPage: async n => ({
      getViewport: ({ scale }) => ({ width: 1100 * scale, height: 760 * scale, scale }),
      render: ({ canvasContext: g, viewport }) => ({ promise: Promise.resolve().then(() => { if (imgs[n - 1]) g.drawImage(imgs[n - 1], 0, 0, viewport.width, viewport.width * imgs[n - 1].height / imgs[n - 1].width); }) }) }) }) }) };
    const file = new File([new Uint8Array([37, 80, 68, 70])], "t.pdf", { type: "application/pdf" });
    IMP.file = file; IMP.page = 1; IMP.pdf = null; document.getElementById("impAll").checked = true; await runImport();
    const o = { n: IMP.results.length, pages: IMP.results.map(x => x.page), apply: !document.getElementById("impApply").disabled };
    IMP.file = file; document.getElementById("impAll").checked = false; IMP.page = 2; IMP.pdf = null; await runImport(); o.single = IMP.results.length + ":" + (IMP.results[0] && IMP.results[0].page);
    document.getElementById("impAll").checked = true; IMP.pdf = null; await runImport();
    document.querySelector('input[name="impMode"][value="replace"]').checked = true; applyImport(); o.measures = state.score.measures.length;
    o.dbg = pagesSc.map(s => s.measures.length).join(); o.per = IMP.results.map(x => x.res.measures.length + "/" + x.res.systems.length).join(","); o.notes = state.score.measures.reduce((a, m) => a + m.up.length + m.down.length, 0);
    return o;
  });
  console.log(JSON.stringify(r));
  ok(r.n === 2 && r.pages.join() === "1,2", "楽譜のある2ページを読み取り、空のページは飛ばす"); ok(r.apply, "取り込みボタンが使える"); ok(r.single === "1:2", "1ページだけの取り込みも従来どおり");
  ok(r.measures === 12, "全ページの小節がつながって取り込まれる(8+4=12) " + r.measures); ok(r.notes > 40, "音符も入っている " + r.notes);
  ok(!errs.length, "エラーなし " + errs.join("|")); console.log(bad ? "FAILED" : "ALL PASSED"); await b.close(); process.exit(bad ? 1 : 0);
})();
