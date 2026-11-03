// フラム/ドラッグ: 楽譜データ・保存・表示・演奏イベント
const { chromium } = require("/opt/npm-tools/node_modules/playwright");
(async () => {
  const b = await chromium.launch(), p = await b.newPage(); let fail = 0, errs = [];
  p.on("pageerror", e => errs.push(String(e)));
  const ok = (c, m) => { console.log((c ? "ok: " : "NG: ") + m); if (!c) fail = 1; };
  await p.goto("file://" + process.cwd() + "/index.html"); await p.waitForTimeout(300);
  const r = await p.evaluate(() => {
    const sc = newScore(), m = sc.measures[0]; toggleNote(m, "snare", 0, 48, false); toggleNote(m, "snare", 96, 48, false); toggleNote(m, "kick", 96, 48, false);
    const a = toggleNoteFlag(sc, 0, 48, "fl"), b2 = toggleNoteFlag(sc, 96, 144, "dr"), c = toggleNoteFlag(sc, 0, 48, "dr");
    const out = { a, b2, c, n0: { fl: !!m.up[0].fl, dr: !!m.up[0].dr }, n1: { fl: !!m.up[1].fl, dr: !!m.up[1].dr } };
    const re = migrateScore(JSON.parse(JSON.stringify(sc))); out.kept = re.ok && re.score.measures[0].up[0].dr === true && re.score.measures[0].up[1].dr === true;
    const ev = buildPlayEvents(sc, { expr: false }).events; out.graces = ev.filter(e => e.grace).map(e => [e.gt, e.i.join(), e.grace]);
    const svg = scoreToSvgDocument(sc); out.svgOk = svg.length > 500 && /<ellipse[^>]*rx="3.6"/.test(svg);
    return out;
  });
  ok(r.c === 1 && r.n0.dr && !r.n0.fl, "フラムをドラッグに切り替えると両立しない");
  ok(r.n1.dr, "ドラッグが付く"); ok(r.kept, "保存して読み込んでも残る");
  ok(r.graces.length === 4 && r.graces.every(g => g[1] === "snare"), "演奏: 装飾音はスネアだけに付き、キックには付かない " + JSON.stringify(r.graces));
  ok(r.svgOk, "楽譜に小さな音符が描かれる");
  const ss = await p.evaluate(() => {
    const sc = newScore(), m = sc.measures[0]; const r1 = toggleNote(m, "sidestick", 48, 48, false);
    const wav = synthDrum("sidestick", 2, 0, 44100); let pk = 0; for (const v of wav) pk = Math.max(pk, Math.abs(v));
    return { r1, h: INSTRUMENTS.sidestick.h, up: m.up.length === 1, pk: pk, guess: [guessInstrument("SideStick_1.wav"), guessInstrument("snare_rim_hit.wav")], svg: /<path d="M[^"]*L/.test(scoreToSvgDocument(sc)) };
  });
  ok(ss.r1 === "added" && ss.h === 3 && ss.up, "サイドスティックを置ける(スネアの高さ・上の声部)");
  ok(ss.pk > 0.05, "サイドスティックの音が出る " + ss.pk.toFixed(2));
  ok(ss.guess[0] === "sidestick" && ss.guess[1] === "snare", "ファイル名から判定 " + ss.guess.join());
  ok(errs.length === 0, "エラーなし " + errs.join()); await b.close(); process.exit(fail);
})();
