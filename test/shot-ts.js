const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1180, height: 900 } });
  await p.goto("file://" + process.cwd() + "/index.html");
  await p.evaluate(() => { const s = newScore(); s.measures = []; ["4/4", "3/4", "4/4", "5/4", "7/8", "6/8", "2/2", "12/8"].forEach(ts => { const m = newMeasure(ts), i = tsInfo(ts); for (let t = 0; t < i.ticks; t += 24) toggleNote(m, "hh_close", t, 24, false); toggleNote(m, "kick", 0, 48, false); toggleNote(m, "snare", i.beat, 48, false); s.measures.push(m); }); state.score = s; commit(); });
  await p.screenshot({ path: "out/ts.png", clip: { x: 0, y: 140, width: 1180, height: 560 } }); await b.close();
})();
