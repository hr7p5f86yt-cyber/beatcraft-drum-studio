// ファイル名から パーツ と 強さ の印を読む
const { guessInstrument, velRank } = require("../src/samples.js"); let bad = 0;
const ok = (c, m) => { console.log((c ? "ok: " : "NG: ") + m); if (!c) bad++; };
const g = [["hihatClosed_OH_P_1.wav", "hh_close"], ["hihatOpen_OH_FF_1.wav", "hh_open"], ["snare_OH_Ghost_1.wav", "snare"], ["kick_OH_F_3.wav", "kick"], ["hiTom_OH_F_1.wav", "hi_tom"],
  ["loTom_OH_MP_1.wav", "low_tom"], ["floorTom_1.wav", "low_tom"], ["crash1_OH_P_1.wav", "crash"], ["ride1_OH_MP_1.wav", "ride"], ["hihatFoot_OH_MP_1.wav", "hh_pedal"]];
g.forEach(([n, e]) => ok(guessInstrument(n) === e, n + " → " + e));
const order = ["x_Ghost_1", "x_PP_1", "x_P_1", "x_MP_1", "x_F_1", "x_FF_1"].map(velRank);
ok(order.every((v, i) => i === 0 || v > order[i - 1]), "Ghost<PP<P<MP<F<FF の順");
ok(velRank("snare_01.wav") === -1 && velRank("opening_1.wav") === -1, "印がなければ -1(単語の一部は無視)");
console.log(bad ? "FAILED" : "ALL PASSED"); process.exit(bad ? 1 : 0);
