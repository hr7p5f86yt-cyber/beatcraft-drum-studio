const { chromium } = require("playwright"); let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("NG:", m); } else console.log("ok:", m); };
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1180, height: 820 } }); const errs = []; p.on("pageerror", e => errs.push(e.message));
  await p.goto("file://" + process.cwd() + "/index.html"); await p.evaluate(() => document.body.classList.add("show-adv"));
  const g = () => p.evaluate(() => state.score.measures.map(m => [m.sim ? 1 : 0, m.up.length + m.down.length]));
  await p.evaluate(() => { state.cursor = { m: 0, t: 0 }; state.base = 48; }); await p.keyboard.press("k"); await p.keyboard.press("s");
  await p.evaluate(() => { state.cursor = { m: 1, t: 0 }; }); await p.keyboard.press("%");
  let r = await g(); ok(r[1][0] === 1 && r[1][1] === 0, "% キーで前の小節と同じになる");
  await p.keyboard.press("c"); r = await g(); ok(r[1][0] === 0 && r[1][1] === 3, "%の小節に入力すると元の内容を写して通常の小節に戻る");
  await p.evaluate(() => openMeasureModal(2)); await p.check("#simCheck"); await p.check("#dblCheck"); await p.fill("#markInput", "Intro"); await p.click("#measureOk");
  r = await p.evaluate(() => { const m = state.score.measures[2]; return [m.sim, m.dbl, m.mark]; }); ok(r[0] && r[1] && r[2] === "Intro", "小節の設定から%・二重線・Introを付けられる");
  await p.click("#autoMrBtn"); await p.click("#undoBtn"); await p.click("#undoBtn");
  ok(errs.length === 0, "エラーなし " + errs); console.log(fail ? "FAILED" : "ALL PASSED"); await b.close();
})();
