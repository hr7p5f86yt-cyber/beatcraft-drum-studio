const M = require("../src/model.js");
let fail = 0;
function ok(c, msg) { if (!c) { fail++; console.log("NG:", msg); } else console.log("ok:", msg); }
function sumTicks(ev) { return ev.reduce((a, e) => a + e.d, 0); }

// 1) 空の声部 → 4/4 は休符で192tick埋まる
let m = M.newMeasure("4/4");
let ev = M.fillRests(m.up, 192, 48);
ok(sumTicks(ev) === 192, "空小節の休符合計=192 (" + ev.map(e => e.d).join(",") + ")");

// 2) 4分キック + 8分休符 + 8分キック の隙間補完
M.toggleNote(m, "kick", 0, 48, false);
M.toggleNote(m, "kick", 72, 24, false);
ev = M.fillRests(m.down, 192, 48);
ok(sumTicks(ev) === 192, "キック声部の合計=192 (" + ev.map(e => (e.rest ? "r" : "n") + e.d).join(",") + ")");

// 3) 同じ位置に別楽器 → 和音、同じ楽器で削除
M.toggleNote(m, "snare", 48, 48, false);
M.toggleNote(m, "hh_close", 48, 48, false);
ok(m.up.find(n => n.t === 48).i.length === 2, "同じ位置の和音");
ok(M.toggleNote(m, "snare", 48, 48, false) === "removed", "同じ楽器で削除");
ok(m.up.find(n => n.t === 48).i.length === 1, "削除は選択楽器だけ");

// 4) 長い音符を置くと、範囲内の後続音符が消え、手前が短くなる
let m2 = M.newMeasure("4/4");
for (let k = 0; k < 8; k++) M.toggleNote(m2, "hh_close", k * 24, 24, false);
M.toggleNote(m2, "hh_close", 36, 96, false);          // 36〜132 の長い音符(8分の途中から)
const ts = m2.up.map(n => n.t + ":" + n.d).join(" ");
ok(m2.up.every((n, k, a) => k === 0 || a[k - 1].t + a[k - 1].d <= n.t), "重ならない (" + ts + ")");
ok(m2.up.some(n => n.t === 36 && n.d === 96) && !m2.up.some(n => n.t === 48 || n.t === 72 || n.t === 96 || n.t === 120), "範囲内の後続音符が消える");
ok(m2.up.find(n => n.t === 24).d === 12, "手前の音符は12に短縮");

// 5) 3連符の隙間: 8分3連の1つ目だけ → 残り2つは3連符休符
let m3 = M.newMeasure("4/4");
M.toggleNote(m3, "snare", 0, 16, true);
ev = M.fillRests(m3.up, 192, 48);
ok(sumTicks(ev) === 192, "3連符+休符の合計=192 (" + ev.map(e => (e.rest ? "r" : "n") + e.d + (e.tup ? "t" : "")).join(",") + ")");
ok(M.tupletGroups(ev.filter(e => e.tup)).length === 1, "3連符は1組");

// 6) 6/8 の休符
ev = M.fillRests([], 144, 72);
ok(sumTicks(ev) === 144, "6/8 の空休符=144 (" + ev.map(e => e.d).join(",") + ")");

// 7) 連桁: 8分4つ(2拍) → 拍ごとに2つずつの組
let m4 = M.newMeasure("4/4");
for (let k = 0; k < 8; k++) M.toggleNote(m4, "hh_close", k * 24, 24, false);
ev = M.fillRests(m4.up, 192, 48);
const bg = M.beamGroups(ev, 48);
ok(bg.length === 4 && bg.every(g => g.length === 2), "8分8つ=2つずつ4組 (" + bg.length + ")");

// 8) 小節端のはみ出し: 最後の16分位置に4分 → 収まる長さに
let m5 = M.newMeasure("4/4");
M.toggleNote(m5, "kick", 180, 48, false);
ok(m5.down[0] && m5.down[0].d === 12, "はみ出しは12に短縮 (" + (m5.down[0] && m5.down[0].d) + ")");

// 9) 旧形式の移行
const old5 = { version: "5.1.0", title: "旧", bpm: 100, measures: [{ timeSignature: "4/4", notes: { 0: [{ inst: "kick", duration: 24 }], 24: [{ inst: "snare", duration: 24 }] } }] };
let r = M.migrateScore(old5);
ok(r.ok && r.score.measures[0].down[0].t === 0 && r.score.measures[0].up[0].t === 48 && r.score.measures[0].up[0].d === 48, "v5 → v3 移行");
r = M.migrateScore({ version: "2.4.0", measures: [{ notes: { 3: [{ inst: "snare", length: 1 }] } }] });
ok(r.ok && r.score.measures[0].up[0].t === 36, "v2 ステップ移行");
r = M.migrateScore({ foo: 1 });
ok(!r.ok, "壊れたデータは拒否");

// 10) 保存→読込で同じ
const s = M.newScore(); M.toggleNote(s.measures[0], "kick", 0, 48, false); M.toggleNote(s.measures[1], "snare", 16, 16, true);
r = M.migrateScore(JSON.parse(JSON.stringify(s)));
ok(r.ok && JSON.stringify(r.score) === JSON.stringify(s), "保存→読込が往復で一致");

console.log(fail ? "FAILED " + fail : "ALL PASSED");
process.exit(fail ? 1 : 0);
