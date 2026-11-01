const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1180, height: 900 } });
  const errs = []; p.on("pageerror", e => errs.push(e.message));
  await p.goto("file://" + process.cwd() + "/index.html"); await p.waitForTimeout(300);
  await p.evaluate(() => {
    const s = newScore(); s.title = "テスト曲"; s.bpm = 106;
    s.measures = []; for (let i = 0; i < 5; i++) s.measures.push(newMeasure()); s.measures.push(newMeasure("2/4")); s.measures[0].mark = "Intro"; s.measures[0].mr = true;
    const a = () => { const m = newMeasure(); for (let k = 0; k < 8; k++) toggleNote(m, "hh_close", k * 24, 24, false); toggleNote(m, "snare", 48, 48, false); toggleNote(m, "snare", 144, 48, false); toggleNote(m, "kick", 0, 48, false); toggleNote(m, "kick", 120, 24, false); return m; };
    for (let i = 0; i < 5; i++) s.measures.push(a()); s.measures[6].mark = "A"; s.measures[6].mr = false;
    const ms = s.measures; ms[5].dbl = true;
    for (let i = 0; i < 4; i++) ms.push(newMeasure()); ms[11].mark = "B"; ms[11].mr = true;
    state.score = s; commit(); applyAutoSim(); applyAutoMr();
  });
  await p.waitForTimeout(200); await p.screenshot({ path: "out/sim.png", clip: { x: 0, y: 100, width: 1180, height: 520 } });
  console.log(await p.evaluate(() => JSON.stringify(state.score.measures.map(m => (m.sim ? "%" : m.mr ? "mr" : "n")))), errs);
  const play = await p.evaluate(() => { Player.rebuild(state.score); return [Player.events.length, Player.total]; }); console.log(play);
  await b.close();
})();
