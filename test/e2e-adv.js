// iPad: 「⚙ 詳細」を押すと詳細パネルが画面いっぱいに開き、「✕ 閉じる」で閉じる。パネルの中から「録音した音を使う」も開ける
const { chromium } = require("playwright"); const path = require("path");
(async () => {
  const b = await chromium.launch(); let bad = 0; const errs = [];
  const ok = (c, m) => { console.log((c ? "ok: " : "NG: ") + m); if (!c) bad++; };
  for (const [w, h] of [[1180, 820], [820, 1180]]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, hasTouch: true }); p.on("pageerror", e => errs.push(String(e)));
    await p.goto("file://" + path.resolve(process.argv[2] || "index.html")); await p.waitForTimeout(300);
    const vis = () => p.evaluate(() => { const e = document.getElementById("advPanel"), r = e.getBoundingClientRect(); return getComputedStyle(e).display !== "none" && r.top >= 0 && r.bottom <= innerHeight && r.height > 200; });
    ok(!(await vis()), `${w}x${h}: 最初は閉じている`);
    await p.tap("#advBtn"); await p.waitForTimeout(200);
    ok(await vis(), `${w}x${h}: 詳細を押すと画面内に開く`);
    ok(await p.evaluate(() => { const r = document.getElementById("sampleBtn").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), `${w}x${h}: 「録音した音を使う」が見える`);
    await p.tap("#sampleBtn"); await p.waitForTimeout(200);
    ok(await p.evaluate(() => document.getElementById("sampleModal").classList.contains("show")), `${w}x${h}: 録音した音の画面が開く`);
    await p.evaluate(() => document.querySelector('[data-close="sampleModal"]').click());
    await p.tap("#advClose"); await p.waitForTimeout(200);
    ok(!(await vis()), `${w}x${h}: 閉じるで閉じる`);
    await p.tap(".dk-btn:has-text('音源')"); await p.waitForTimeout(200);
    ok(await p.evaluate(() => document.getElementById("sampleModal").classList.contains("show")), `${w}x${h}: 下のボタン「🥁 音源」からも開ける`);
    await p.close();
  }
  ok(!errs.length, "エラーなし " + errs.join("|")); console.log(bad ? "FAILED" : "ALL PASSED"); await b.close(); process.exit(bad ? 1 : 0);
})();
