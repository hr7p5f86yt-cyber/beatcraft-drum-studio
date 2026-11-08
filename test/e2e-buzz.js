// バズロール(z): 付ける・外す / 楽譜に z が描かれる / 演奏で細かい連打になる / 保存→読込で残る / 足の音には付かない
const { chromium } = require("/opt/npm-tools/node_modules/playwright");
(async () => {
  const b = await chromium.launch(), p = await b.newPage(), errs = []; p.on("pageerror", e => errs.push(e.message));
  await p.goto("file://" + process.cwd() + "/index.html"); await p.waitForTimeout(300);
  let bad = 0; const ck = (c, m) => { console.log((c ? "ok: " : "NG: ") + m); if (!c) bad++; };
  const r = await p.evaluate(() => {
    const s = newScore(), m = s.measures[0]; toggleNote(m, "snare", 48, 24, false); toggleNote(m, "kick", 0, 48, false);
    const base = buildScoreSvg(s).svg.length;
    const n = toggleNoteFlag(s, 48, 72, "bz"), k = toggleNoteFlag(s, 0, 24, "bz");           // kick には付かない
    const svg = buildScoreSvg(s).svg, ev = buildPlayEvents(s).events.filter(e => e.i[0] === "snare");
    const back = migrateScore(JSON.parse(JSON.stringify(s)));
    const off = toggleNoteFlag(s, 48, 72, "bz");
    return { n, k, grew: svg.length > base, snareHits: ev.length, last: ev.map(e => e.gt).join(","), kept: !!(back.ok && back.score.measures[0].up.concat(back.score.measures[0].down).some(x => x.bz)), off, still: m.up.concat(m.down).some(x => x.bz) };
  });
  ck(r.n === 1 && r.k === 0, "snareに付き、kickには付かない " + JSON.stringify([r.n, r.k]));
  ck(r.grew, "楽譜に z が描かれる");
  ck(r.snareHits >= 3, "演奏で細かくくり返される " + r.last);
  ck(r.kept, "保存→読込で残る");
  ck(r.off === 1 && !r.still, "もう一度押すと外れる");
  ck(await p.evaluate(() => !!document.getElementById("buzzBtn")), "ボタンがある");
  console.log(errs.length ? "ERRORS " + errs.join("|") : "no page errors"); if (bad || errs.length) process.exitCode = 1; else console.log("ALL PASSED"); await b.close();
})();
