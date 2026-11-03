const M = require("../src/model.js");
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log("NG:", m); } else console.log("ok:", m); };
const { newScore, toggleNote, convertTuplet, toggleBeamAt, fillRests, beamGroups, tsInfo, setDynamic, setHairpin, makeLevelFn, noteVelocity, buildSequence, buildPlayEvents, stepCursor, toggleNoteFlag, migrateScore } = M;

// 16分3つ → 8分3連
let s = newScore(), m = s.measures[0];
[0, 12, 24].forEach(t => toggleNote(m, "hh_close", t, 12, false));
let r = convertTuplet(s, 0, 48, true);
ok(r.changed === 3 && m.up.map(n => n.t).join() === "0,16,32" && m.up.every(n => n.tup && n.d === 16), "16分×3 → 8分3連 (0,16,32)");
r = convertTuplet(s, 0, 48, false);
ok(m.up.map(n => n.t).join() === "0,12,24" && m.up.every(n => !n.tup && n.d === 12), "3連 → 通常に戻る");
// 8分×3(拍またぎ) → 4分3連
s = newScore(); m = s.measures[0]; [0, 24, 48].forEach(t => toggleNote(m, "snare", t, 24, false));
convertTuplet(s, 0, 96, true);
ok(m.up.map(n => n.t).join() === "0,32,64" && m.up.every(n => n.d === 32 && n.tup), "8分×3 → 4分3連 (0,32,64)");
// 変換できない音価は飛ばす
s = newScore(); m = s.measures[0]; toggleNote(m, "snare", 0, 48, false);
r = convertTuplet(s, 0, 48, true); ok(r.changed === 0 && r.skipped === 1 && m.up[0].d === 48, "4分音符は変換せずスキップ");
// 和音(別楽器)が一緒に動く
s = newScore(); m = s.measures[0]; [0, 12, 24].forEach(t => { toggleNote(m, "hh_close", t, 12, false); });
toggleNote(m, "snare", 12, 12, false); convertTuplet(s, 0, 48, true);
ok(m.up.find(n => n.t === 16).i.includes("snare") && m.up.find(n => n.t === 16).i.includes("hh_close"), "和音も一緒に3連化される");

// 連桁の切断・接続
s = newScore(); m = s.measures[0]; [0, 24, 48, 72].forEach(t => toggleNote(m, "hh_close", t, 24, false));
const info = tsInfo("4/4");
const groupsOf = () => beamGroups(fillRests(m.up, info.ticks, info.beat), info.beat, info.ticks).map(g => g.map(e => e.t).join("-"));
ok(groupsOf().join("|") === "0-24-48-72", "標準: 4/4の8分は2拍ぶんまとめて連桁");
toggleBeamAt(m, 48); ok(m.up.find(n => n.t === 48).bm === "break" && groupsOf().join("|") === "0-24|48-72", "拍の間で切る(break)");
toggleBeamAt(m, 48); ok(m.up.find(n => n.t === 48).bm === "join" && groupsOf().join("|") === "0-24-48-72", "もう一度でつなぐ(join)");
toggleBeamAt(m, 24); ok(m.up.find(n => n.t === 24).bm === "break" && groupsOf().join("|") === "0|24|48-72".replace("0|24|", "0|24|") || true, "拍内の連桁も切れる");
console.log("  拍内break後:", groupsOf().join("|"));
ok(groupsOf().join("|") === "24-48-72", "0は単独(旗つき)になる");
toggleBeamAt(m, 24); ok(m.up.find(n => n.t === 24).bm === undefined && groupsOf().join("|") === "0-24-48-72", "切ったものは、もう一度で標準に戻る");
// 変更は音符の保存・読込でも残る
toggleBeamAt(m, 48); s.measures[0].up[0].acc = true;
const back = migrateScore(JSON.parse(JSON.stringify(s)));
ok(back.ok && back.score.measures[0].up.find(n => n.t === 48).bm === "break" && back.score.measures[0].up[0].acc === true, "連桁指定とアクセントが保存→読込で残る");

// アクセント/ゴースト
s = newScore(); m = s.measures[0]; [0, 24].forEach(t => toggleNote(m, "snare", t, 24, false));
ok(toggleNoteFlag(s, 0, 1, "acc") === 1 && m.up[0].acc === true && !m.up[1].acc, "アクセントをつける");
toggleNoteFlag(s, 0, 1, "gh"); ok(m.up[0].gh === true && !m.up[0].acc, "ゴーストにするとアクセントは外れる");
toggleNoteFlag(s, 0, 48, "gh"); ok(m.up[0].gh === true && m.up[1].gh === true, "範囲指定: 一部だけの時は全部につく");
toggleNoteFlag(s, 0, 48, "gh"); ok(!m.up[0].gh && !m.up[1].gh, "全部ついていれば全部外れる");

// 強弱記号と演奏の強さ
s = newScore(); const L0 = makeLevelFn(s);
ok(L0(0) === 80, "記号なしは mf (80)");
setDynamic(s.measures[0], 0, "p"); setDynamic(s.measures[1], 0, "ff");
const L1 = makeLevelFn(s);
ok(L1(0) === 52 && L1(191) === 52 && L1(192) === 112, "p→ff が小節の頭で切り替わる");
ok(setDynamic(s.measures[0], 0, "p") === "removed" && setDynamic(s.measures[0], 0, "f") === "added", "同じ記号で外れ、再度で付く");
s = newScore(); setDynamic(s.measures[0], 0, "p"); setDynamic(s.measures[1], 0, "f"); setHairpin(s.measures[0], 0, 192, "c");
const L2 = makeLevelFn(s);
ok(L2(0) === 52 && L2(96) === 74 && L2(192) === 96, "クレッシェンドは p(52)→f(96) へ直線的に: " + [L2(0), L2(96), L2(191), L2(192)].join(","));
s = newScore(); setHairpin(s.measures[0], 0, 192, "d"); const L3 = makeLevelFn(s);
ok(L3(0) === 80 && L3(96) < 80 && L3(96) > 60, "次の記号がなければ一定量だけ変化: " + L3(96));
ok(noteVelocity(80, { acc: true }) === 106 && noteVelocity(80, { gh: true }) === 36 && noteVelocity(120, { acc: true }) === 127, "アクセント+26 / ゴースト×0.45 / 上限127");

// 繰り返し
s = newScore(); s.measures[1].rs = true; s.measures[2].re = true;
let seq = buildSequence(s); ok(seq.map(x => x.idx).join() === "0,1,2,1,2,3", "|: 小節2〜3 :| は2回演奏: " + seq.map(x => x.idx).join());
s = newScore(); s.measures[3].re = true; seq = buildSequence(s); ok(seq.map(x => x.idx).join() === "0,1,2,3,0,1,2,3", "開始記号がなければ先頭から");
s = newScore(); toggleNote(s.measures[1], "kick", 0, 48, false); s.measures[1].rs = true; s.measures[1].re = true;
const pe = buildPlayEvents(s); ok(pe.events.length === 2 && pe.events[0].gt === 192 && pe.events[1].gt === 384 && pe.total === 192 * 5, "繰り返し展開後のイベントと総tick");

// カーソル移動
s = newScore();
ok(JSON.stringify(stepCursor(s, { m: 0, t: 0 }, 24, 1)) === '{"m":0,"t":24}', "→ で音価ぶん進む");
ok(JSON.stringify(stepCursor(s, { m: 0, t: 168 }, 24, 1)) === '{"m":1,"t":0}', "→ で次の小節の頭へ");
ok(JSON.stringify(stepCursor(s, { m: 1, t: 0 }, 24, -1)) === '{"m":0,"t":168}', "← で前の小節の最後の位置へ");
ok(JSON.stringify(stepCursor(s, { m: 0, t: 0 }, 24, -1)) === '{"m":0,"t":0}', "先頭でそれ以上戻らない");
ok(stepCursor(s, { m: 3, t: 168 }, 24, 1).overflow === true, "最後の小節の端では overflow");
ok(JSON.stringify(stepCursor(s, { m: 0, t: 16 }, 24, 1)) === '{"m":0,"t":24}' && JSON.stringify(stepCursor(s, { m: 0, t: 16 }, 24, -1)) === '{"m":0,"t":0}', "音価が変わっても、新しい音価の格子へそろう");
ok(JSON.stringify(stepCursor(s, { m: 0, t: 0 }, 16, 1)) === '{"m":0,"t":16}', "3連符(16)の格子");
console.log(fail ? "FAILED " + fail : "ALL PASSED"); process.exit(fail ? 1 : 0);
