// %(前と同じ)を記号/音符で切り替える表示、1小節休みの「1」
const { chromium } = require("playwright"); const path = require("path");
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1180, height: 820 } }); const errs = []; let bad = 0;
  p.on("pageerror", e => errs.push(String(e))); const ok = (c, m) => { console.log((c ? "ok: " : "NG: ") + m); if (!c) bad++; };
  await p.goto("file://" + path.resolve(process.argv[2] || "index.html")); await p.waitForTimeout(300);
  const r = await p.evaluate(() => {
    const sc = newScore(); sc.measures = []; for (let i = 0; i < 4; i++) { const m = newMeasure("4/4"); for (let t = 0; t < 192; t += 24) toggleNote(m, "hh_close", t, 24, false); toggleNote(m, "snare", 48, 24, false); if (i > 0) m.sim = true; sc.measures.push(m); }
    state.score = sc; commit(); const o = {};
    const heads = () => state.view.heads.length, pct = () => document.querySelectorAll("#scoreSvg polygon").length;
    o.h0 = heads(); o.p0 = pct();
    document.getElementById("simNotesChk").checked = true; document.getElementById("simNotesChk").dispatchEvent(new Event("change"));
    o.h1 = heads(); o.p1 = pct(); o.flag = state.score.simNotes; o.data = state.score.measures.filter(m => m.sim).length;
    const back = migrateScore(JSON.parse(JSON.stringify(state.score))); o.keep = back.ok && back.score.simNotes === true && back.score.measures[1].sim === true;
    o.svg = scoreToSvgDocument(state.score).includes("<polygon");
    document.querySelector("[data-simstyle-btn]").click(); o.p2 = pct(); o.flag2 = state.score.simNotes;
    const s2 = newScore(); s2.measures = [newMeasure("2/4")]; s2.measures[0].mr = true; state.score = s2; commit();
    o.one = [...document.querySelectorAll("#scoreSvg text")].some(t => t.textContent === "1" && t.getAttribute("font-size") === "21");
    return o;
  });
  console.log(JSON.stringify(r));
  ok(r.p0 === 3, "標準は%記号で表示"); ok(r.p1 === 0 && r.h1 > r.h0, "音符表示に切り替えると%が音符になる"); ok(r.flag && r.data === 3, "データ上は%のまま");
  ok(r.keep, "保存→読込でも設定が残る"); ok(!r.svg, "画像書き出しにも反映される"); ok(r.p2 === 3 && r.flag2 === false, "ボタンで記号表示に戻る"); ok(r.one, "1小節休みに「1」が付く");
  ok(!errs.length, "エラーなし " + errs.join("|")); console.log(bad ? "FAILED" : "ALL PASSED"); await b.close(); process.exit(bad ? 1 : 0);
})();
