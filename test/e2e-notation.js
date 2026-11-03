// 表記のテスト: 小節番号は段の一番左だけ・テンポは最初の小節の上・副題と作曲者
const { chromium } = require("playwright"); const path = require("path");
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1180, height: 820 } }); const errs = []; let bad = 0;
  p.on("pageerror", e => errs.push(String(e))); const ok = (c, m) => { console.log((c ? "ok: " : "NG: ") + m); if (!c) bad++; };
  await p.goto("file://" + path.resolve(process.argv[2] || "index.html")); await p.waitForTimeout(300);
  const r = await p.evaluate(() => {
    const sc = newScore(); sc.measures = []; for (let i = 0; i < 12; i++) { const m = newMeasure("4/4"); toggleNote(m, "snare", 0, 48, false); sc.measures.push(m); }
    sc.subtitle = "副題"; sc.composer = "作曲者 X"; sc.bpm = 106; state.score = sc; commit();
    const svg = document.getElementById("scoreSvg"), L = layoutScore(sc);
    const rowFirst = L.measures.filter(it => it.first).map(it => it.idx + 1);
    const shown = [...svg.querySelectorAll("text[data-measure]")].map(t => t.textContent);
    const hit = svg.querySelectorAll("rect[data-measure]").length;
    return { rowFirst, shown, hit, txt: svg.textContent, tempo: svg.textContent.includes("= 106") };
  });
  console.log(JSON.stringify({ rowFirst: r.rowFirst, shown: r.shown, hit: r.hit }));
  ok(r.shown.join() === r.rowFirst.filter(n => n > 1).join(), "小節番号は段の一番左の小節だけ(1小節目は省略) " + r.shown.join());
  ok(r.hit === 12, "全小節にタップ用の当たり判定が残る"); ok(r.tempo, "テンポ記号が最初の小節の上にある"); ok(r.txt.includes("副題") && r.txt.includes("作曲者 X"), "副題と作曲者が表示される");
  await p.evaluate(() => { const t = document.querySelector("rect[data-measure='3']"); t.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  ok(await p.evaluate(() => document.getElementById("measureModal").classList.contains("show")), "番号が見えない小節でもタップで設定を開ける");
  ok(!errs.length, "エラーなし " + errs.join("|")); console.log(bad ? "FAILED" : "ALL PASSED"); await b.close(); process.exit(bad ? 1 : 0);
})();
