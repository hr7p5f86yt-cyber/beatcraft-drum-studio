const { chromium } = require("playwright"); let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("NG:", m); } else console.log("ok:", m); };
(async () => {
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] }), p = await b.newPage({ viewport: { width: 1180, height: 700 } }); const errs = []; p.on("pageerror", e => errs.push(e.message));
  await p.goto("file://" + process.cwd() + "/index.html"); await p.evaluate(() => document.body.classList.add("show-adv"));
  await p.evaluate(() => { const s = newScore(); s.bpm = 240; s.measures = []; for (let i = 0; i < 40; i++) { const m = newMeasure(i % 9 === 4 ? "3/4" : "4/4"); toggleNote(m, "kick", 0, 48, false); s.measures.push(m); } state.score = s; commit(); });
  ok(await p.evaluate(() => state.score.measures[4].ts === "3/4"), "途中の3拍子が入る");
  await p.evaluate(() => openMeasureModal(5)); await p.selectOption("#tsSelect", "5/4"); await p.selectOption("#tsScope", "run"); await p.click("#measureOk");
  const t = await p.evaluate(() => [state.score.measures[5].ts, state.score.measures[12].ts, state.score.measures[13].ts]);
  ok(t[0] === "5/4" && t[1] === "5/4" && t[2] === "3/4", "「同じ拍子が続く範囲」だけ変わる " + t);
  await p.evaluate(() => scrollTo(0, 0)); await p.click("#playBtn"); await p.waitForTimeout(9000);
  const y = await p.evaluate(() => [scrollY, Player.locate(Player.nowTick())]); ok(y[0] > 100, "再生中に画面が自動でスクロールした (scrollY=" + Math.round(y[0]) + ")");
  const vis = await p.evaluate(() => { const r = document.getElementById("playhead").getBoundingClientRect(); return r.top > 0 && r.bottom < innerHeight; }); ok(vis, "演奏中の段が画面内にある");
  await p.click("#stopBtn"); await p.waitForTimeout(1500); await p.evaluate(() => { state.follow = false; scrollTo(0, 0); document.getElementById("playBtn").click(); }); await p.waitForTimeout(6000);
  const y2 = await p.evaluate(() => scrollY); ok(y2 < 5, "自動スクロールをオフにすると動かない " + y2);
  ok(errs.length === 0, "エラーなし " + errs); console.log(fail ? "FAILED" : "ALL PASSED"); await b.close();
})();
