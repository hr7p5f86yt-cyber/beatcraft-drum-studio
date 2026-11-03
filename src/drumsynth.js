/* ===== drumsynth.js : 生ドラム風の音を計算で作る(純粋な関数。ブラウザ/Node 両用) =====
 * 外部の音源ファイルを使わず、ドラムの「鳴り方」をモデル化して波形を作る。
 *   ・強さ(ベロシティ)ごとに3段階の波形を用意(弱いほど丸く、強いほど硬く明るい)
 *   ・同じ楽器でも2種類ずつ(ラウンドロビン)作り、機関銃のような同じ音の連打を避ける
 *   ・シンバル/ハイハットは非整数倍の倍音の集まり + ノイズで金属の響きを作る
 * 戻り値は -1〜1 の Float32Array(モノラル)。 */
const DRUM_LAYERS = [40, 82, 120];                 // 弱・中・強の基準ベロシティ
const DRUM_VARIANTS = 3;

function rngFrom(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/* 2次フィルタ(RBJ)。x を直接書き換えて返す。type: "lp" | "hp" | "bp" */
function biquad(x, type, f, q, sr) {
  const w = 2 * Math.PI * Math.min(f, sr * 0.45) / sr, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
  let b0, b1, b2;
  if (type === "lp") { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
  else if (type === "hp") { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
  else { b0 = al; b1 = 0; b2 = -al; }
  const a0 = 1 + al, a1 = -2 * c / a0, a2 = (1 - al) / a0; b0 /= a0; b1 /= a0; b2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let n = 0; n < x.length; n++) {
    const xn = x[n], y = b0 * xn + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xn; y2 = y1; y1 = y; x[n] = y;
  }
  return x;
}
function noiseArr(n, rnd) { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = rnd() * 2 - 1; return a; }
/* 減衰する正弦波を加算する(回転漸化式なので速い)。fn: 周波数(t)=一定でなければ使えないため一定周波数用 */
function addPartial(out, sr, f, amp, tau, phase0, attack) {
  const n = out.length, w = 2 * Math.PI * f / sr, dc = Math.cos(w), ds = Math.sin(w), dk = Math.exp(-1 / (tau * sr));
  let c = Math.cos(phase0 || 0), s = Math.sin(phase0 || 0), e = amp;
  const atk = attack ? Math.max(1, Math.round(attack * sr)) : 0;
  for (let i = 0; i < n; i++) {
    const g = atk && i < atk ? i / atk : 1;
    out[i] += s * e * g; const nc = c * dc - s * ds; s = s * dc + c * ds; c = nc; e *= dk;
    if (e < 1e-5) break;
  }
}
function addDecayNoise(out, noise, amp, tau, from) {
  const n = out.length, sr = 1; void sr;
  const dk = Math.exp(-1 / tau); let e = amp;     // tau はサンプル数
  for (let i = from || 0; i < n; i++) { out[i] += noise[i] * e; e *= dk; if (e < 1e-5) break; }
}
function normalizePeak(x, peak, sr) {
  let m = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > m) m = a; }
  const g = m > 0 ? peak / m : 1, fade = Math.round(0.008 * sr);          // 末尾を短くなめらかに閉じる(プチノイズ防止)
  for (let i = 0; i < x.length; i++) x[i] *= g;
  for (let i = 0; i < fade && i < x.length; i++) x[x.length - 1 - i] *= i / fade;
  return x;
}

function synthDrum(key, layer, variant, sr) {
  const v = DRUM_LAYERS[layer] / 127, rnd = rngFrom(hashStr(key) + layer * 131 + variant * 7919);
  const jit = (a) => 1 + (rnd() - 0.5) * 2 * a;          // ±a のばらつき
  const peak = 0.3 + 0.62 * v;                           // 強い層ほど大きく
  let out;
  if (key === "kick") {
    const n = Math.round(0.75 * sr); out = new Float32Array(n);
    const f0 = (96 + 70 * v) * jit(0.04), fEnd = 47 * jit(0.04), tauP = 0.032, tauA = 0.07 + 0.05 * (1 - v);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, f = fEnd + (f0 - fEnd) * Math.exp(-t / tauP);
      ph += 2 * Math.PI * f / sr;
      out[i] = Math.sin(ph) * Math.exp(-t / tauA) + 0.28 * Math.sin(2 * ph) * Math.exp(-t / 0.045);
    }
    const click = biquad(noiseArr(n, rnd), "hp", 2200, 0.7, sr);        // ビーターが皮に当たる音
    addDecayNoise(out, click, (0.1 + 0.55 * v), 0.0022 * sr);
    const drive = 1.1 + 1.6 * v; for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * drive);
    biquad(out, "hp", 28, 0.7, sr);
  } else if (key === "snare") {
    const n = Math.round(0.6 * sr); out = new Float32Array(n);
    const f1 = 187 * jit(0.03);
    addPartial(out, sr, f1 * 1.03, 0.9, 0.05, 0);        // 打面の基音(少し高めから)
    addPartial(out, sr, f1 * 1.62, 0.45, 0.035, 1);
    addPartial(out, sr, f1 * 2.35, 0.25, 0.022, 2);
    for (let i = 0; i < n; i++) out[i] *= (0.45 + 0.55 * v);
    const wire = biquad(biquad(noiseArr(n, rnd), "hp", 1500, 0.7, sr), "bp", 5200 * jit(0.05), 0.55, sr);   // スナッピー
    const wire2 = new Float32Array(n);
    addDecayNoise(wire2, wire, 1.0, (0.045 + 0.04 * v) * sr); addDecayNoise(wire2, wire, 0.38, 0.14 * sr);
    const wa = 0.7 * (0.55 + 0.9 * v); for (let i = 0; i < n; i++) out[i] += wire2[i] * wa * 2.2;
    const stick = biquad(noiseArr(n, rnd), "hp", 3800, 0.7, sr);
    addDecayNoise(out, stick, 0.25 + 0.4 * v, 0.0016 * sr);
  } else if (key === "sidestick") {                    // サイドスティック(リムクリック): 乾いた木の「コッ」
    const n = Math.round(0.16 * sr); out = new Float32Array(n);
    addPartial(out, sr, 1180 * jit(0.03), 0.9, 0.012, 0);
    addPartial(out, sr, 1930 * jit(0.03), 0.55, 0.008, 1);
    addPartial(out, sr, 3100 * jit(0.04), 0.3, 0.005, 2);
    const ck = biquad(biquad(noiseArr(n, rnd), "hp", 1800, 0.7, sr), "bp", 3200, 0.9, sr);
    addDecayNoise(out, ck, 0.55, 0.0045 * sr);
    for (let i = 0; i < n; i++) out[i] *= (0.5 + 0.5 * v);
  } else if (key === "hh_close" || key === "hh_open" || key === "hh_pedal") {
    const open = key === "hh_open", n = Math.round((open ? 1.4 : key === "hh_pedal" ? 0.12 : 0.22) * sr); out = new Float32Array(n);
    const base = [2900, 3300, 3800, 4100, 4700, 5200, 5800, 6300, 6900, 7400, 8000, 8700, 9300, 9800, 10500, 11200, 12000, 12600, 13400, 14300];
    base.forEach((f, k) => {                              // 金属の円盤の細かい倍音。ほぼ同じ高さの2つの音を重ねて「うなり」(ジャラジャラ感)を作る
      const tau = (open ? 0.55 : 0.036) * (1.3 - k * 0.04) * jit(0.15), fr = f * jit(0.035), amp = (0.4 + 0.6 * rnd()) * (0.5 + 0.7 * v * (k / 10)) * 0.55;
      const beat = open ? 3 + rnd() * 11 : 6 + rnd() * 20;
      addPartial(out, sr, fr, amp, tau, rnd() * 6.28);
      addPartial(out, sr, fr + beat, amp * 0.8, tau * 0.9, rnd() * 6.28);
    });
    const nz = biquad(biquad(noiseArr(n, rnd), "hp", 6500, 0.7, sr), "hp", 6500, 0.7, sr);
    addDecayNoise(out, nz, 0.9 * (0.5 + 0.8 * v), (open ? 0.3 : 0.022) * sr);
    if (open) addDecayNoise(out, nz, 0.25, 0.7 * sr);
    biquad(out, "hp", 3000, 0.7, sr);
    if (key === "hh_pedal") for (let i = 0; i < n; i++) out[i] *= 0.5;                  // 足で踏む「チッ」: 閉じたハイハットより小さく短く
  } else if (key === "hi_tom" || key === "low_tom") {
    const hi = key === "hi_tom", n = Math.round((hi ? 0.7 : 0.95) * sr); out = new Float32Array(n);
    const fe = (hi ? 205 : 112) * jit(0.03), tauA = (hi ? 0.2 : 0.3), drop = 0.32 + 0.2 * v;
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, f = fe * (1 + drop * Math.exp(-t / 0.03));
      ph += 2 * Math.PI * f / sr;
      out[i] = Math.sin(ph) * Math.exp(-t / tauA) + 0.32 * Math.sin(ph * 1.58 + 0.7) * Math.exp(-t / (tauA * 0.45));
    }
    const hit = biquad(noiseArr(n, rnd), "hp", 1800, 0.7, sr);
    addDecayNoise(out, hit, 0.15 + 0.5 * v, 0.004 * sr);
    const body = biquad(noiseArr(n, rnd), "bp", fe * 2.2, 1.2, sr);                 // 胴鳴り
    addDecayNoise(out, body, 0.4 * v, 0.05 * sr);
  } else if (key === "ride" || key === "crash") {
    const ride = key === "ride", n = Math.round((ride ? 2.2 : 3.2) * sr); out = new Float32Array(n);
    const nP = 44;
    for (let k = 0; k < nP; k++) {
      const f = ride ? 2300 + k * 300 * jit(0.15) + rnd() * 300 : 800 + k * 330 * jit(0.15) + rnd() * 380;
      const tau = (ride ? 1.7 : 1.3) * (1.15 - k / nP * 0.85) * jit(0.2);
      const bright = 0.45 + 0.55 * v * (k / nP) * 2, amp = (0.3 + 0.7 * rnd()) * bright * 0.7, atk = ride ? 0.001 : 0.006 + 0.02 * (k / nP);
      const ph = rnd() * 6.28, bt = 1.5 + rnd() * 9;       // 近い周波数の2つを重ねて、ゆらぎ(シャーン…と波打つ感じ)を作る
      addPartial(out, sr, f, amp, tau, ph, atk);
      addPartial(out, sr, f + bt, amp * 0.85, tau * 0.92, rnd() * 6.28, atk);
    }
    const nz = biquad(noiseArr(n, rnd), "hp", ride ? 4500 : 3000, 0.7, sr);
    addDecayNoise(out, nz, ride ? 0.45 : 1.2, (ride ? 0.55 : 0.9) * sr);
    if (ride) {
      [2950, 3700, 5150].forEach(f => addPartial(out, sr, f * jit(0.02), 0.9, 0.85, rnd() * 6.28));     // 「チーン」というピン
      const tick = biquad(noiseArr(n, rnd), "hp", 6000, 0.7, sr); addDecayNoise(out, tick, 0.9, 0.0035 * sr);   // スティックの当たり
    } else {
      for (let i = 0; i < n; i++) out[i] *= 1 + 0.5 * Math.exp(-i / (0.1 * sr));                         // 叩いた直後の勢い
    }
    biquad(out, "hp", ride ? 1200 : 600, 0.7, sr);
  } else {
    out = new Float32Array(Math.round(0.1 * sr));
  }
  return normalizePeak(out, peak, sr);
}

if (typeof module !== "undefined") {
  module.exports = Object.assign(module.exports || {}, { DRUM_LAYERS, DRUM_VARIANTS, synthDrum, biquad });
}
