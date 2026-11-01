const M = require("../src/model.js"); let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("NG:", m); } else console.log("ok:", m); };
for (const k of Object.keys(M.TIME_SIGS)) {
  const info = M.tsInfo(k), m = M.newMeasure(k);
  M.toggleNote(m, "kick", info.ticks - 12, 12, false); M.toggleNote(m, "hh_close", 0, 24, false);
  const sum = v => M.fillRests(m[v], info.ticks, info.beat).reduce((a, e) => a + e.d, 0);
  ok(sum("up") === info.ticks && sum("down") === info.ticks, `${k}: 休符込みで小節の長さにぴったり`);
}
const m = M.newMeasure("4/4"); M.toggleNote(m, "snare", 144, 48, false); M.toggleNote(m, "kick", 180, 12, false);
const cut = M.setMeasureTs(m, "3/4"); ok(m.ts === "3/4" && m.up.every(n => n.t + n.d <= 144) && m.down.length === 0, "4/4→3/4で、はみ出す音符を整える");
const sc = M.newScore(); sc.measures = [M.newMeasure("4/4"), M.newMeasure("3/4"), M.newMeasure("4/4")];
ok(M.buildPlayEvents(sc).total === 192 + 144 + 192, "拍子が変わる楽譜の演奏の長さが合う");
console.log(fail ? "FAILED" : "ALL PASSED"); process.exit(fail ? 1 : 0);
