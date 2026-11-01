const { chromium } = require("playwright"); let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("NG:", m); } else console.log("ok:", m); };
(async () => {
  for (const [w, h, name] of [[1180, 820, "iPad横"], [820, 1100, "iPad縦"]]) {
    const b = await chromium.launch(), p = await b.newPage({ viewport: { width: w, height: h }, hasTouch: true }); const errs = []; p.on("pageerror", e => errs.push(e.message));
    await p.goto("file://" + process.cwd() + "/" + (process.argv[2] || "index.html")); await p.waitForTimeout(300);
    const wd = () => p.evaluate(() => Math.round(document.getElementById("scoreSvg").getBoundingClientRect().width));
    const w100 = await wd(); const tap = t => p.locator("#dock").getByText(t, { exact: true }).tap();
    await tap("－"); await tap("－"); const w60 = await wd(); await tap("＋"); await tap("＋"); await tap("＋"); const w120 = await wd();
    ok(w60 < w100 - 40 && w120 > w100 + 40 && w60 < w120, `${name}: 60%<100%<120% で楽譜の大きさが実際に変わる (${w60} / ${w100} / ${w120})`);
    await p.evaluate(() => { toggleNote(state.score.measures[0], "kick", 0, 48, false); commit(); }); const wAfter = await wd(); ok(Math.abs(wAfter - w120) < 3, `${name}: 音符を入力しても拡大率が戻らない`);
    ok(errs.length === 0, name + ": エラーなし " + errs); await b.close();
  }
  console.log(fail ? "FAILED" : "ALL PASSED");
})();
