// 合成ドラムの数値チェック(耳では確認できないため、波形の性質を測る)
const { synthDrum, DRUM_LAYERS } = require("../src/drumsynth.js");
const sr = 44100; let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("NG:", m); } else console.log("ok:", m); };
function dft(x, f) { let re = 0, im = 0; const w = 2 * Math.PI * f / sr; for (let i = 0; i < x.length; i++) { re += x[i] * Math.cos(w * i); im += x[i] * Math.sin(w * i); } return Math.hypot(re, im) / x.length; }
function bandEnergy(x, lo, hi) { let e = 0; const step = Math.max(20, (hi - lo) / 40); for (let f = lo; f <= hi; f += step) e += dft(x, f) ** 2; return e; }
function rms(x, a, b) { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); }
function decayTime(x, db) { // 最大値から db 下がった後ずっと下回る時刻(秒) 10msごとのRMSで判定
  const win = Math.round(0.01 * sr); let peak = 0; const r = [];
  for (let i = 0; i + win <= x.length; i += win) { const v = rms(x, i, i + win); r.push(v); if (v > peak) peak = v; }
  const th = peak * Math.pow(10, -db / 20); let last = 0; r.forEach((v, k) => { if (v > th) last = k; }); return (last + 1) * 0.01;
}
const t0 = Date.now(), all = {};
const keys = ["kick", "snare", "hh_close", "hh_open", "hi_tom", "low_tom", "ride", "crash"];
for (const k of keys) for (let L = 0; L < 3; L++) for (let v = 0; v < 2; v++) all[k + L + v] = synthDrum(k, L, v, sr);
const ms = Date.now() - t0;
console.log("全48波形の生成時間:", ms, "ms");
ok(ms < 3000, "生成が3秒以内 (" + ms + "ms)");
let bad = 0;
for (const id in all) { const x = all[id]; let pk = 0; for (const s of x) { if (!isFinite(s)) bad++; pk = Math.max(pk, Math.abs(s)); } if (pk > 0.95 || pk < 0.2) bad++; }
ok(bad === 0, "すべて有限値で、ピークが0.2〜0.95に収まる");
// 強い層ほど大きい
ok(rms(all.snare20, 0, 4000) > rms(all.snare00, 0, 4000), "スネア: 強い層の方が大きい");
// 低域/高域のバランス
const kLow = bandEnergy(all.kick10.subarray(0, 8000), 40, 120), kHigh = bandEnergy(all.kick10.subarray(0, 8000), 4000, 9000);
ok(kLow > kHigh * 50, "キック: 低域が高域より圧倒的に強い");
const hLow = bandEnergy(all.hh_close10, 100, 800), hHigh = bandEnergy(all.hh_close10, 6000, 12000);
ok(hHigh > hLow * 20, "ハイハット: 高域が主体");
ok(bandEnergy(all.snare10, 3000, 8000) > bandEnergy(all.snare10, 100, 300) * 0.05, "スネア: スナッピー(高域)成分がある");
// 長さ
const dk = decayTime(all.kick10, 40), ds = decayTime(all.snare10, 40), dc = decayTime(all.hh_close10, 40), dop = decayTime(all.hh_open10, 40), dcr = decayTime(all.crash20, 40), dri = decayTime(all.ride10, 40);
console.log("減衰(-40dB)秒:", { kick: dk, snare: ds, hhC: dc, hhO: dop, crash: dcr, ride: dri });
ok(dc < 0.2 && dop > dc * 3, "クローズは短く、オープンは長い");
ok(dcr > 1.2 && dri > 0.8, "シンバルは余韻が長い");
ok(dk > 0.15 && dk < 0.7, "キックの余韻が妥当");
// 2つのバリエーションは別の波形(同じ音の連打にならない)
let diff = 0; for (let i = 0; i < 3000; i++) diff += Math.abs(all.snare10[i] - all.snare11[i]); ok(diff > 1, "ラウンドロビンのバリエーションが異なる");
// 決定的(毎回同じ)
const again = synthDrum("snare", 1, 0, sr); let same = true; for (let i = 0; i < 2000; i++) if (again[i] !== all.snare10[i]) same = false; ok(same, "同じ指定なら同じ波形になる");
// 波形をWAVで出力(確認用)
const fs = require("fs");
function wav(name, x) { const b = Buffer.alloc(44 + x.length * 2); b.write("RIFF", 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(x.length * 2, 40); for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2); fs.writeFileSync(name, b); }
fs.mkdirSync("out", { recursive: true });
// 簡易ロック・ビート(1小節)をミックスして聴き比べ用に保存
const bar = new Float32Array(sr * 4); const q = sr * 0.5;
function hit(id, at, g) { const x = all[id]; for (let i = 0; i < x.length && at + i < bar.length; i++) bar[at + i] += x[i] * g; }
for (let k = 0; k < 8; k++) hit(k % 2 ? "hh_close10" : "hh_close11", Math.round(k * q / 2), k % 2 ? 0.5 : 0.8);
[0, 4].forEach(k => hit("kick10", Math.round(k * q / 2), 1)); hit("kick11", Math.round(5 * q / 2), 0.9);
[2, 6].forEach(k => hit("snare20", Math.round(k * q / 2), 1)); hit("snare00", Math.round(3.5 * q / 2), 0.7);
hit("crash20", 0, 0.6);
let mx = 0; for (const s of bar) mx = Math.max(mx, Math.abs(s)); for (let i = 0; i < bar.length; i++) bar[i] /= mx * 1.05;
wav("out/groove.wav", bar);
console.log(fail ? "FAILED " + fail : "ALL PASSED"); process.exit(fail ? 1 : 0);
