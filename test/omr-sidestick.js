// 自分で描いた楽譜(サイドスティック・フラム)を読み戻せるか
const { chromium } = require("/opt/npm-tools/node_modules/playwright");
(async () => {
  const b = await chromium.launch(), p = await b.newPage(); let fail = 0;
  const ok = (c, m) => { console.log((c ? "ok: " : "NG: ") + m); if (!c) fail = 1; };
  await p.goto("file://" + process.cwd() + "/index.html"); await p.waitForTimeout(300);
  const r = await p.evaluate(async () => {
    const sc = newScore(); sc.measures = [newMeasure(), newMeasure()];
    sc.measures.forEach(m => { for (let t = 0; t < 192; t += 24) toggleNote(m, "hh_close", t, 24, false); toggleNote(m, "kick", 0, 48, false); toggleNote(m, "sidestick", 48, 48, false); toggleNote(m, "kick", 96, 48, false); toggleNote(m, "sidestick", 144, 48, false); });
    toggleNote(sc.measures[1], "snare", 96, 24, false); toggleNoteFlag(sc, 192 + 96, 192 + 120, "fl");
    const svg = scoreToSvgDocument(sc), im = await new Promise((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ng; i.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); });
    const k = 2200 / im.width, c = document.createElement("canvas"); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
    const res = recognizeCanvas(c, "4/4"); if (!res.ok) return { err: res.error };
    const ms = omrToMeasures(res, "4/4"), cnt = { sidestick: 0, ride: 0, snare: 0 };
    res.measures.forEach(m => m.slots.forEach(s => s.heads.forEach(h => { if (h.inst in cnt) cnt[h.inst]++; })));
    return { cnt, fl: ms.some(m => m.up.some(n => n.fl)), n: res.measures.length };
  });
  ok(!r.err, "読み込める " + (r.err || ""));
  ok(r.cnt && r.cnt.sidestick === 4 && r.cnt.ride === 0, "サイドスティック4つ・ライドの読み違いなし " + JSON.stringify(r.cnt));
  ok(r.fl === true, "フラム(装飾音)も読み戻せる");
  await b.close(); process.exit(fail);
})();
