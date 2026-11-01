const { chromium } = require("playwright"); const path = require("path"); const fs = require("fs");
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 820, height: 1100 }, acceptDownloads: true });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", e => errs.push(String(e))); p.on("console", m => { if (m.type()==="error") errs.push(m.text()); });
  await p.goto("file://" + path.resolve("index.html")); await p.evaluate(() => document.body.classList.add("show-adv")); await p.waitForTimeout(300);
  // 参考楽譜風のサンプルを直接データで入れる
  await p.evaluate(() => {
    const s = newScore(); s.title = "テスト曲"; s.bpm = 106; s.measures = [];
    for (let i = 0; i < 6; i++) { const m = newMeasure("4/4"); if (i === 0) m.mark = "A";
      for (let k = 0; k < 8; k++) toggleNote(m, "hh_close", k * 24, 24, false);
      toggleNote(m, "snare", 48, 24, false); toggleNote(m, "snare", 144, 24, false);
      toggleNote(m, "kick", 0, 48, false); toggleNote(m, "kick", 120, 24, false);
      if (i === 2) { toggleNote(m, "crash", 0, 24, false); }
      s.measures.push(m); }
    state.score = s; resetHistory(); commit(true);
  });
  const [d1] = await Promise.all([p.waitForEvent("download"), p.click("#svgBtn")]);
  const svgPath = "out/export.svg"; await d1.saveAs(svgPath);
  const [d2] = await Promise.all([p.waitForEvent("download", { timeout: 8000 }), p.click("#pngBtn")]);
  await d2.saveAs("out/export.png");
  console.log("svg", fs.statSync(svgPath).size, "png", fs.statSync("out/export.png").size, d1.suggestedFilename(), d2.suggestedFilename());
  await p.screenshot({ path: "out/narrow.png", fullPage: true });
  await p.emulateMedia({ media: "print" }); await p.screenshot({ path: "out/print.png", fullPage: true });
  console.log(errs.length ? "ERR " + errs.join("|") : "no errors"); await b.close();
})();
