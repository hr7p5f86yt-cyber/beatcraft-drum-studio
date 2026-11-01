/* ===== omr.js : 画像の楽譜(ドラム譜)を読み取る簡易エンジン =====
 * 外部サービスを使わず、画像処理だけで「五線・小節線・符頭」を見つけ、音符データにする。
 * 流れ: 白黒化 → 傾き補正 → 五線検出 → 五線と小節線を消す → 符幹/補助線を消す
 *       → 符頭(●・×・○)を見つける → 高さでパーツを決める → 横位置から拍(tick)を決める
 * できること : 符頭の位置からパーツと拍の位置を読む(休符は自動で補われる)
 * できないこと: 音符の長さ(連桁・旗)、強弱記号、連符の数字、ゴースト、文字。
 *               → 長さは「次の音符までの間隔(最大4分音符)」で決めるので、読み取り後に手直しする前提。
 * 画像は { g: Uint8Array(グレースケール), w, h } で渡す。ブラウザ/Node両用の純粋な処理。 */

function omrGray(rgba, w, h) {
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return g;
}

/* 周りの明るさに合わせた白黒化(写真の影・ムラに強い)。1=黒 */
function omrBinarize(g, w, h) {
  const bin = new Uint8Array(w * h), W1 = w + 1;
  const win = Math.max(25, (Math.round(Math.min(w, h) / 10) | 1)), half = win >> 1;
  const I = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + row; } }
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half), y1 = Math.min(h, y + half + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half), x1 = Math.min(w, x + half + 1);
      const mean = (I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0]) / ((y1 - y0) * (x1 - x0)), v = g[y * w + x];
      bin[y * w + x] = ((v < mean * 0.87 && v < 215) || v < 80) ? 1 : 0;
    }
  }
  const out = new Uint8Array(w * h);                              // 写真のつぶつぶノイズを消す(まわりに黒がほとんどない点は捨てる)
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; if (!bin[i]) continue;
    const n = bin[i - w - 1] + bin[i - w] + bin[i - w + 1] + bin[i - 1] + bin[i + 1] + bin[i + w - 1] + bin[i + w] + bin[i + w + 1];
    if (n >= 2) out[i] = 1;
  }
  return out;
}

/* 傾き(度)を推定: 五線のような横線が最もくっきり揃う角度 */
function omrSkew(bin, w, h, range, step) {
  range = range || 5; step = step || 0.25;
  let count = 0; for (let i = 0; i < bin.length; i++) count += bin[i];
  const stride = Math.max(1, Math.floor(count / 150000)), xs = [], ys = []; let c = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (bin[y * w + x] && (c++ % stride) === 0) { xs.push(x); ys.push(y); }
  const n = xs.length;
  const score = a => {
    const t = Math.tan(a * Math.PI / 180), off = Math.ceil(Math.abs(t) * w) + 2, hist = new Int32Array(h + 2 * off + 3);
    for (let i = 0; i < n; i++) hist[Math.round(ys[i] - xs[i] * t) + off]++;
    let s = 0; for (let i = 0; i < hist.length; i++) s += hist[i] * hist[i]; return s;
  };
  let best = 0, bs = -1;
  for (let a = -range; a <= range + 0.0001; a += step) { const s = score(a); if (s > bs) { bs = s; best = a; } }
  const c0 = best; for (let a = c0 - step; a <= c0 + step + 0.0001; a += step / 5) { const s = score(a); if (s > bs) { bs = s; best = a; } }
  return best;
}
/* 画像を角度 deg だけ回して傾きを直す(余白は白) */
function omrRotate(g, w, h, deg) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), cx = w / 2, cy = h / 2, out = new Uint8Array(w * h).fill(255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = cx + (x - cx) * c - (y - cy) * s, sy = cy + (x - cx) * s + (y - cy) * c;
    const x0 = Math.floor(sx), y0 = Math.floor(sy); if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) continue;
    const fx = sx - x0, fy = sy - y0, i = y0 * w + x0;
    out[y * w + x] = g[i] * (1 - fx) * (1 - fy) + g[i + 1] * fx * (1 - fy) + g[i + w] * (1 - fx) * fy + g[i + w + 1] * fx * fy;
  }
  return out;
}

/* ---- 五線の検出 ---- */
function omrRowRuns(bin, w, h) {
  const run = new Int32Array(h);
  for (let y = 0; y < h; y++) {
    let best = 0, cur = 0, gap = 0; const o = y * w;
    for (let x = 0; x < w; x++) {
      if (bin[o + x]) { cur += gap + 1; gap = 0; if (cur > best) best = cur; }
      else if (cur > 0) { if (gap < 1) gap++; else { cur = 0; gap = 0; } }
    }
    run[y] = best;
  }
  return run;
}
function omrRunExtent(bin, w, y, minRun) {      // 行 y にある長い線の左端・右端
  let left = -1, right = -1, cur = 0, gap = 0, start = 0; const o = y * w;
  const close = (end) => { if (cur >= minRun) { if (left < 0) left = start; right = end; } };
  for (let x = 0; x < w; x++) {
    if (bin[o + x]) { if (cur === 0) start = x; cur += gap + 1; gap = 0; }
    else if (cur > 0) { if (gap < 1) gap++; else { close(x - 2); cur = 0; gap = 0; } }
  }
  close(w - 1); return [left, right];
}
function omrFindStaves(bin, w, h) {
  const run = omrRowRuns(bin, w, h); let M = 0; for (let y = 0; y < h; y++) M = Math.max(M, run[y]);
  if (M < w * 0.2) return [];
  const thr = Math.max(M * 0.25, w * 0.12), cands = [];
  for (let y = 0; y < h; y++) {                                  // 連続する行をまとめて1本の線にする
    if (run[y] < thr) continue; let y1 = y; while (y1 + 1 < h && run[y1 + 1] >= thr) y1++;
    cands.push({ c: (y + y1) / 2, a: y, b: y1, th: y1 - y + 1 }); y = y1;
  }
  const lines = cands.filter(l => l.th <= 9), staves = [];
  for (let i = 0; i + 4 < lines.length;) {
    const c = lines.slice(i, i + 5).map(l => l.c), d = [c[1] - c[0], c[2] - c[1], c[3] - c[2], c[4] - c[3]], s = (c[4] - c[0]) / 4;
    if (s >= 4 && d.every(v => Math.abs(v - s) <= 0.22 * s)) {
      const ls = lines.slice(i, i + 5), [L, R] = omrRunExtent(bin, w, Math.round(c[2]), thr);
      if (L >= 0 && R - L > w * 0.2) staves.push({ lines: c, band: ls.map(l => [l.a, l.b]), S: s, left: L, right: R, th: Math.round(ls.reduce((a, l) => a + l.th, 0) / 5) });
      i += 5;
    } else i++;
  }
  if (!staves.length) return staves;
  const med = staves.map(s => s.S).sort((a, b) => a - b)[staves.length >> 1];
  return staves.filter(s => Math.abs(s.S - med) <= 0.25 * med);
}

/* ---- 1つの五線を解析して符頭を探す ---- */
function omrAnalyzeStaff(bin, w, h, st) {
  const S = st.S, y0 = st.lines[0], y4 = st.lines[4], log = [];
  // (1) 小節線: 五線の上端〜下端を全部埋める縦線
  const top = Math.round(y0), bot = Math.round(y4), need = (bot - top + 1) * 0.95, cols = [];
  for (let x = st.left; x <= st.right; x++) { let n = 0; for (let y = top; y <= bot; y++) n += bin[y * w + x]; if (n >= need) cols.push(x); }
  let bars = [];
  for (let i = 0; i < cols.length;) { let j = i; while (j + 1 < cols.length && cols[j + 1] - cols[j] <= 1) j++; bars.push({ a: cols[i], b: cols[j] }); i = j + 1; }
  const merged = [];                                              // 近い縦線(終止線・繰り返し)は1つにまとめる
  bars.forEach(b => { const l = merged[merged.length - 1]; if (l && b.a - l.b < 0.9 * S) l.b = b.b; else merged.push({ a: b.a, b: b.b }); });
  if (!merged.length || merged[0].a > st.left + 1.2 * S) merged.unshift({ a: st.left, b: st.left + 1 });
  if (merged[merged.length - 1].b < st.right - 1.2 * S) merged.push({ a: st.right - 1, b: st.right });
  let barX = [];                                                  // 狭すぎる区間(拍子の数字などの縦線)は小節線とみなさない
  merged.forEach((b, i) => {
    const x = (b.a + b.b) / 2, n = barX.length;
    if (!n) { barX.push(x); return; }
    if (x - barX[n - 1] >= 7 * S) barX.push(x);
    else if (i === merged.length - 1 && n > 1) barX[n - 1] = x;     // 最後は右端にそろえる
  });
  if (barX.length < 2) barX = [merged[0].a, merged[merged.length - 1].b];

  // (2) 作業用の領域(五線の上下に符幹がのびる分も含める)
  const ry0 = Math.max(0, Math.floor(y0 - 5.6 * S)), ry1 = Math.min(h - 1, Math.ceil(y4 + 4.8 * S)), rh = ry1 - ry0 + 1;
  const rx0 = Math.max(0, st.left - 2), rx1 = Math.min(w - 1, st.right + 2), rw = rx1 - rx0 + 1;
  const B = new Uint8Array(rw * rh);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) B[y * rw + x] = bin[(ry0 + y) * w + rx0 + x];
  const at = (x, y) => B[(y - ry0) * rw + (x - rx0)];
  // (3) 五線を消す: 線の上下が白い所だけ(符頭・符幹がかかる所は残す)
  st.band.forEach(([a, b]) => {
    const ya = Math.max(ry0 + 1, a - 1), yb = Math.min(ry1 - 1, b + 1);
    for (let x = rx0; x <= rx1; x++) {
      if (!at(x, a - 1) && !at(x, b + 1)) for (let y = a; y <= b; y++) B[(y - ry0) * rw + (x - rx0)] = 0;
      else if (!at(x, ya) && !at(x, yb) && ya === a - 1) for (let y = a; y <= b; y++) B[(y - ry0) * rw + (x - rx0)] = 0;
    }
  });
  // (4) 小節線を消す
  merged.forEach(b => { for (let x = b.a - 1; x <= b.b + 1; x++) if (x >= rx0 && x <= rx1) for (let y = Math.max(ry0, top - 2); y <= Math.min(ry1, bot + 2); y++) B[(y - ry0) * rw + (x - rx0)] = 0; });

  // (4b) 音部記号・拍子記号の範囲: 左端から続く「五線の外に符幹がのびていない」かたまり
  const inA = Math.round(y0 - 0.4 * S) - ry0, inB = Math.round(y4 + 0.4 * S) - ry0, outA = Math.round(y0 - 4.6 * S) - ry0, outA2 = Math.round(y0 - 0.6 * S) - ry0, outB = Math.round(y4 + 0.6 * S) - ry0, outB2 = Math.round(y4 + 3.8 * S) - ry0;
  const colIn = new Uint8Array(rw), colOut = new Uint8Array(rw);
  for (let x = 0; x < rw; x++) {
    const need = Math.max(2, Math.round(0.2 * S)); let n = 0;
    for (let y = Math.max(0, inA); y <= Math.min(rh - 1, inB); y++) n += B[y * rw + x];
    colIn[x] = n >= need ? 1 : 0; n = 0;
    for (let y = Math.max(0, outA); y <= Math.min(rh - 1, outA2); y++) n += B[y * rw + x];
    for (let y = Math.max(0, outB); y <= Math.min(rh - 1, outB2); y++) n += B[y * rw + x];
    colOut[x] = n >= need ? 1 : 0;
  }
  const clusters = [];
  for (let x = 0; x < rw; x++) if (colIn[x]) { const l = clusters[clusters.length - 1]; if (l && x - l.b <= 0.9 * S) { l.b = x; l.out = l.out || colOut[x]; } else clusters.push({ a: x, b: x, out: colOut[x] }); }
  let zoneEnd = rx0;
  if (clusters.length && clusters[0].a < 3 * S && clusters[0].b < 4 * S) {
    zoneEnd = rx0 + clusters[0].b;
    for (let k = 1; k < clusters.length; k++) { const c = clusters[k]; if (c.a - (zoneEnd - rx0) <= 2.5 * S && !c.out && c.b - c.a <= 2.2 * S) zoneEnd = rx0 + c.b; else break; }
  }

  // (5) 縦・横にのびる黒の長さを求める
  const vr = new Uint16Array(rw * rh), hr = new Uint16Array(rw * rh);
  for (let x = 0; x < rw; x++) { let y = 0; while (y < rh) { if (!B[y * rw + x]) { y++; continue; } let e = y; while (e + 1 < rh && B[(e + 1) * rw + x]) e++; for (let k = y; k <= e; k++) vr[k * rw + x] = e - y + 1; y = e + 1; } }
  for (let y = 0; y < rh; y++) { let x = 0; while (x < rw) { if (!B[y * rw + x]) { x++; continue; } let e = x; while (e + 1 < rw && B[y * rw + e + 1]) e++; for (let k = x; k <= e; k++) hr[y * rw + k] = e - x + 1; x = e + 1; } }
  const C = Uint8Array.from(B), stemMax = Math.max(3, 0.36 * S + 1), ledRow0 = Math.round(y0 - 1.5 * S) - ry0, ledRow1 = Math.round(y0 - 0.5 * S) - ry0;
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const i = y * rw + x; if (!B[i]) continue;
    if (vr[i] >= 1.7 * S && hr[i] <= stemMax) C[i] = 0;                                          // 符幹
    else if (y >= ledRow0 && y <= ledRow1 && hr[i] >= 1.15 * S && hr[i] <= 2.6 * S && vr[i] <= st.th + 2) C[i] = 0;   // 補助線
  }
  // (6) 符頭の候補: 五線のまわり(上は開いたハイハットの○まで、下はキックまで)だけを見る
  const by0 = Math.max(0, Math.round(y0 - 2.6 * S) - ry0), by1 = Math.min(rh - 1, Math.round(y4 + 0.9 * S) - ry0);
  const lab = new Int32Array(rw * rh), comps = []; let nid = 0; const stack = [];
  for (let y = by0; y <= by1; y++) for (let x = 0; x < rw; x++) {
    if (!C[y * rw + x] || lab[y * rw + x]) continue;
    const id = ++nid; let minx = x, maxx = x, miny = y, maxy = y, area = 0; stack.length = 0; stack.push(y * rw + x); lab[y * rw + x] = id;
    while (stack.length) {
      const p = stack.pop(), py = (p / rw) | 0, px = p - py * rw; area++;
      if (px < minx) minx = px; if (px > maxx) maxx = px; if (py < miny) miny = py; if (py > maxy) maxy = py;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = px + dx, ny = py + dy; if (nx < 0 || ny < by0 || nx >= rw || ny > by1) continue;
        const q = ny * rw + nx; if (C[q] && !lab[q]) { lab[q] = id; stack.push(q); }
      }
    }
    comps.push({ id, minx, maxx, miny, maxy, area, w: maxx - minx + 1, h: maxy - miny + 1 });
  }
  // 穴(中が白く抜けている)があるか: 外側から塗りつぶして、届かない白があれば穴
  const hasHole = c => {
    const W = c.w + 2, H = c.h + 2, seen = new Uint8Array(W * H), st2 = [0]; seen[0] = 1; let outside = 0;
    const solid = (px, py) => px >= 1 && py >= 1 && px <= c.w && py <= c.h && lab[(c.miny + py - 1) * rw + (c.minx + px - 1)] === c.id;
    while (st2.length) { const p = st2.pop(), py = (p / W) | 0, px = p - py * W; outside++; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = px + dx, ny = py + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const q = ny * W + nx; if (seen[q] || solid(nx, ny)) continue; seen[q] = 1; st2.push(q); } }
    return W * H - c.area - outside > 0;
  };
  const hasStem = c => {                                           // 符頭のすぐ上か下に、長い縦線(符幹)があるか
    for (const yy of [c.miny - 2, c.maxy + 2]) { if (yy < 0 || yy >= rh) continue; for (let xx = Math.max(0, Math.round(c.minx - 0.25 * S)); xx <= Math.min(rw - 1, Math.round(c.maxx + 0.25 * S)); xx++) if (vr[yy * rw + xx] >= 1.7 * S) return true; }
    return false;
  };
  const rr = Math.max(1, Math.round(0.16 * S));
  const thick = c => {                                              // 太さがある(休符の細い線ではない)か
    let keep = 0;
    for (let y = c.miny + rr; y <= c.maxy - rr; y++) for (let x = c.minx + rr; x <= c.maxx - rr; x++) {
      if (lab[y * rw + x] !== c.id) continue; let ok = true;
      for (let dy = -rr; dy <= rr && ok; dy++) for (let dx = -rr; dx <= rr; dx++) if (lab[(y + dy) * rw + x + dx] !== c.id) { ok = false; break; }
      if (ok) keep++;
    }
    return keep >= 0.18 * c.area;
  };
  const heads = [], rings = [], tall = [];
  for (const c of comps) {
    const bw = c.w / S, bh = c.h / S, fill = c.area / (c.w * c.h), cx = rx0 + (c.minx + c.maxx) / 2, cy = ry0 + (c.miny + c.maxy) / 2;
    if (c.area < 0.12 * S * S) continue;                                                   // ごみ・付点
    const hole = hasHole(c);
    if (hole && bw <= 0.85 && bh <= 0.85 && bw >= 0.3) { rings.push({ cx, cy }); continue; }   // ハイハットのオープン記号 ○
    if (rx0 + c.maxx <= zoneEnd + 0.3 * S) continue;                                        // 音部記号・拍子記号
    if (hole && bw >= 0.65 && bw <= 1.8 && bh >= 0.55 && bh <= 1.3 && hasStem(c)) heads.push({ x: cx, y: cy, kind: "oval" });     // 白い符頭(2分音符など)
  }
  // ×印の符頭(ハイハット・シンバル): 2本の斜めの線が交わる形を探す。×が隣とくっついていても見つけられる
  {
    const rc = Math.max(2, Math.round(0.46 * S)), rg = Math.max(2, Math.round(0.3 * S));
    const cy0 = Math.max(rc, Math.round(y0 - 1.5 * S) - ry0), cy1 = Math.round(y0 + 0.5 * S) - ry0, Dl = new Uint8Array(rw * rh), cand = [];
    for (let y = Math.max(1, cy0 - rc); y <= Math.min(rh - 2, cy1 + rc); y++) for (let x = 1; x < rw - 1; x++) {
      let v = 0; for (let dy = -1; dy <= 1 && !v; dy++) for (let dx = -1; dx <= 1; dx++) if (C[(y + dy) * rw + x + dx]) { v = 1; break; }
      Dl[y * rw + x] = v;
    }
    for (let y = cy0; y <= cy1; y++) for (let x = rc + 1; x < rw - rc - 1; x++) {
      if (rx0 + x <= zoneEnd + 0.3 * S) continue;
      let hit = 0; for (let k = -rc; k <= rc; k++) hit += Dl[(y + k) * rw + x + k] + Dl[(y - k) * rw + x + k];
      const fr = hit / (2 * (2 * rc + 1)); if (fr < 0.8) continue;
      const gap = C[(y - rg) * rw + x] + C[(y + rg) * rw + x] + C[y * rw + x - rg] + C[y * rw + x + rg];
      if (gap > 2 || (gap === 2 && fr < 0.93)) continue;
      cand.push({ x, y, sc: fr - 0.3 * gap });
    }
    cand.sort((a, b) => b.sc - a.sc);
    const acc = [];
    cand.forEach(c => { if (acc.some(a => Math.hypot(a.x - c.x, a.y - c.y) < 0.55 * S)) return; acc.push(c); });
    const rcache = [];                                              // ○ の位置(×の上)。○のまわりに出る偽の×を捨てるために使う
    const ringOf = c => {
      const rr0 = Math.max(2, Math.round(0.3 * S)); let best = null;
      for (let dy = -1.5; dy <= -0.7; dy += 0.1) for (let dx = -0.25; dx <= 0.25; dx += 0.1) {
        const cx = Math.round(c.x + dx * S), cy = Math.round(c.y + dy * S); let n = 0; const tot = 12;
        if (cy - rr0 - 1 < 0 || cx - rr0 - 1 < 0 || cx + rr0 + 1 >= rw) continue;
        for (let a = 0; a < tot; a++) n += Dl[(cy + Math.round(rr0 * Math.sin(a * Math.PI / 6))) * rw + cx + Math.round(rr0 * Math.cos(a * Math.PI / 6))];
        if (n / tot >= 0.92 && !C[cy * rw + cx] && !C[(cy + 1) * rw + cx] && (!best || n / tot > best.sc)) best = { x: cx, y: cy, sc: n / tot };
      }
      return best;
    };
    acc.forEach(c => { c.ring = c.y - Math.round(0.4 * S) >= Math.round(y0 - 1.5 * S) - ry0 - 1 && ringOf(c); if (c.ring) rcache.push(c.ring); });
    const accF = acc.filter(c => c.ring || !rcache.some(r => Math.abs(r.x - c.x) < 0.7 * S && Math.abs(r.y - c.y) < 0.7 * S));
    accF.forEach(c => {
      let stem = false;
      for (const yy of [c.y - Math.round(0.8 * S), c.y + Math.round(0.8 * S)]) { if (yy < 0 || yy >= rh) continue; for (let xx = Math.max(0, Math.round(c.x - 0.7 * S)); xx <= Math.min(rw - 1, Math.round(c.x + 0.7 * S)); xx++) if (vr[yy * rw + xx] >= 1.7 * S) stem = true; }
      if (!stem) return;
      const hd = { x: rx0 + c.x, y: ry0 + c.y, kind: "cross" };
      if (c.ring) hd.ring = true;
      heads.push(hd);
    });
  }
  // 黒い符頭: 細い線(休符・符幹・×印)が消えるまで縮めて、残った芯を符頭とする(休符とくっついていても分けられる)
  const er = Math.max(1, Math.ceil(0.22 * S)), Hh = new Uint8Array(rw * rh), E = new Uint8Array(rw * rh);
  for (let y = by0; y <= by1; y++) for (let x = er; x < rw - er; x++) { let ok = 1; for (let d = -er; d <= er; d++) if (!C[y * rw + x + d]) { ok = 0; break; } Hh[y * rw + x] = ok; }
  for (let y = by0 + er; y <= by1 - er; y++) for (let x = 0; x < rw; x++) { let ok = 1; for (let d = -er; d <= er; d++) if (!Hh[(y + d) * rw + x]) { ok = 0; break; } E[y * rw + x] = ok; }
  const seen = new Uint8Array(rw * rh);
  for (let y = by0; y <= by1; y++) for (let x = 0; x < rw; x++) {
    if (!E[y * rw + x] || seen[y * rw + x] || rx0 + x <= zoneEnd + 0.3 * S) continue;
    let sx = 0, sy = 0, n = 0, minx = x, maxx = x, miny = y, maxy = y; stack.length = 0; stack.push(y * rw + x); seen[y * rw + x] = 1;
    while (stack.length) {
      const q = stack.pop(), qy = (q / rw) | 0, qx = q - qy * rw; sx += qx; sy += qy; n++;
      if (qx < minx) minx = qx; if (qx > maxx) maxx = qx; if (qy < miny) miny = qy; if (qy > maxy) maxy = qy;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = qx + dx, ny = qy + dy; if (nx < 0 || ny < by0 || nx >= rw || ny > by1) continue; const r2 = ny * rw + nx; if (E[r2] && !seen[r2]) { seen[r2] = 1; stack.push(r2); } }
    }
    const cw = maxx - minx + 1, ch = maxy - miny + 1;
    if (n < 0.06 * S * S || cw > 1.3 * S || ch > 1.1 * S) continue;
    const c = { minx: Math.round(minx - er), maxx: Math.round(maxx + er), miny: Math.round(miny - er), maxy: Math.round(maxy + er) };
    const hh = (ry0 + sy / n - y0) / (S / 2), ox = rx0 + sx / n, oy = ry0 + sy / n;
    if (heads.some(q => q.kind === "cross" && Math.abs(q.x - ox) < 0.7 * S && Math.abs(q.y - oy) < 0.9 * S)) continue;
    if (hh >= 0.3 && hh <= 8.6 && hasStem(c)) heads.push({ x: rx0 + sx / n, y: ry0 + sy / n, kind: "oval" });
  }
  // (7) パーツの決定: 形(×/丸)と五線上の高さ(半スペース単位 h)から
  const CROSS = [["crash", -2], ["hh_close", -1], ["ride", 0]], OVAL = [["hi_tom", 1], ["snare", 3], ["low_tom", 5], ["kick", 7]];
  heads.forEach(hd => {
    hd.h = (hd.y - y0) / (S / 2);
    const tab = hd.kind === "cross" ? CROSS : OVAL; let best = tab[0];
    tab.forEach(t => { if (Math.abs(t[1] - hd.h) < Math.abs(best[1] - hd.h) - 1e-9) best = t; });
    hd.inst = best[0];
    if (hd.kind === "oval" && hd.h > 6) hd.inst = "kick";
    if (hd.kind === "cross" && hd.inst === "hh_close" && (hd.ring || rings.some(r => Math.abs(r.cx - hd.x) < 0.9 * S && r.cy < hd.y && hd.y - r.cy < 2 * S))) hd.inst = "hh_open";
  });
  return { st, barX, heads, zoneEnd, S };
}

/* ---- 横位置 → 拍(tick) ---- */
/* xs: 小さい順の音符の横位置。c: 小節の左端(基準)。W: 小節の幅。T: 小節のtick数。padL: 左の余白の目安 */
function omrQuantize(xs, c, W, T, S, padL, first) {
  const n = xs.length; if (!n) return [];
  const X0e = c + padL, k0 = Math.max(0.0001, (W - padL - 0.6 * S) / T);
  const grids = [{ g: 24, tup: false, pen: 0 }, { g: 12, tup: false, pen: 0.05 }, { g: 16, tup: true, pen: 0.07 }, { g: 6, tup: false, pen: 0.14 }, { g: 8, tup: true, pen: 0.16 }];
  let best = null;
  for (const gr of grids) for (let dx = -0.9; dx <= (first ? 3.8 : 0.9) + 0.0001; dx += 0.15) for (let kk = 0.8; kk <= 1.2001; kk += 0.015) {
    const X0 = X0e + dx * S, k = k0 * kk; let err = 0, mx = 0;
    const tf0 = (xs[0] - X0) / k; if (tf0 < -5) continue;                  // 小節より前になる配置はありえない
    for (let i = 0; i < n; i++) { const t = (xs[i] - X0) / k / gr.g, r = Math.abs(t - Math.round(t)); err += r; if (r > mx) mx = r; }
    const cost = err / n + gr.pen + (mx > 0.35 ? 0.2 : 0) + 0.02 * Math.abs(first ? 0 : dx) + 0.05 * Math.max(0, tf0) / 12;   // 小節の頭に音符があることが多い
    if (!best || cost < best.cost) best = { cost, X0, k, gr };
  }
  const perBeat = {};                                             // 拍ごとに、いちばん合う格子(8分/16分/32分/3連符)を選ぶ
  const tfs = xs.map(x => { const tf = (x - best.X0) / best.k, beat = Math.max(0, Math.floor(Math.round(tf / 4) * 4 / 48)); (perBeat[beat] = perBeat[beat] || []).push(tf - beat * 48); return { tf, beat }; });
  const pick = {};
  Object.keys(perBeat).forEach(b => {
    const ps = perBeat[b]; let bg = null;
    for (const gr of grids) {
      const e = ps.reduce((a, p) => a + Math.abs(p / gr.g - Math.round(p / gr.g)), 0) / ps.length + gr.pen;
      if (!bg || e < bg.e - 1e-9) bg = { e, gr };
    }
    pick[b] = bg.gr;
  });
  return tfs.map(o => {
    const gr = pick[o.beat], p = o.tf - o.beat * 48; let q = Math.round(p / gr.g) * gr.g;
    if (q >= 48) return { t: Math.max(0, Math.min(T - 6, (o.beat + 1) * 48)), tup: false };        // 次の拍の頭に丸められた
    if (q < 0) q = 0;
    return { t: Math.max(0, Math.min(T - 6, o.beat * 48 + q)), tup: gr.tup };
  });
}

/* ---- 全体 ---- */
/* gray 画像 → { ok, error, stavesInfo[], measures[], S, skew, gray(傾き補正後), w, h }
 * opt.ts: 拍子 "4/4" など */
function omrRecognize(g0, w, h, opt) {
  opt = opt || {}; const ts = tsInfo(opt.ts || "4/4"), T = ts.ticks;
  let bin = omrBinarize(g0, w, h), skew = omrSkew(bin, w, h), g = g0;
  if (Math.abs(skew) >= 0.1) {
    g = omrRotate(g0, w, h, skew); bin = omrBinarize(g, w, h);
    const fine = omrSkew(bin, w, h, 0.6, 0.06);                  // 仕上げの微調整(わずかな傾きも、横に長い五線ではずれが大きくなるため)
    if (Math.abs(fine) >= 0.04) { g = omrRotate(g, w, h, fine); bin = omrBinarize(g, w, h); skew += fine; }
  }
  const staves = omrFindStaves(bin, w, h);
  if (!staves.length) return { ok: false, error: "五線が見つかりませんでした。楽譜が画面いっぱいに写るようにして、もう一度お試しください。", skew, gray: g, w, h, S: 0 };
  const S = staves.map(s => s.S).sort((a, b) => a - b)[staves.length >> 1];
  const systems = staves.map(st => omrAnalyzeStaff(bin, w, h, st));
  // 左の余白の目安(最初の音符が小節線からどれだけ右にあるか。中央値)
  const offs = [];
  systems.forEach(sy => { for (let m = 1; m + 1 < sy.barX.length + 1 && m < sy.barX.length; m++) { const a = sy.heads.filter(hd => hd.x > sy.barX[m - 1] + 0.5 * S && hd.x < sy.barX[m]); if (a.length) { const first = Math.min(...a.map(q => q.x)); const d = first - sy.barX[m - 1]; if (d <= 3.4 * S) offs.push(d); } } });
  offs.sort((a, b) => a - b); const padL = offs.length ? offs[offs.length >> 1] : 1.8 * S;
  const measures = [];
  systems.forEach((sy, si) => {
    const clefEnd = Math.max(sy.barX[0], sy.zoneEnd);
    for (let m = 0; m + 1 < sy.barX.length; m++) {
      const xl = sy.barX[m], xr = sy.barX[m + 1]; if (xr - xl < 2.5 * S) continue;
      const c = m === 0 ? clefEnd : xl, W = xr - c;
      const hs = sy.heads.filter(q => q.x > (m === 0 ? c : xl) && q.x < xr).sort((a, b) => a.x - b.x);
      const onsets = [];                                           // 近い x を同じ拍(和音)にまとめる
      hs.forEach(q => { const l = onsets[onsets.length - 1]; if (l && q.x - l.x <= 0.6 * S) { l.heads.push(q); l.x = (l.x * (l.heads.length - 1) + q.x) / l.heads.length; } else onsets.push({ x: q.x, heads: [q] }); });
      const qs = omrQuantize(onsets.map(o => o.x), c, W, T, S, padL, m === 0);
      const slots = [];
      onsets.forEach((o, i) => { const q = qs[i], l = slots[slots.length - 1]; if (l && l.t === q.t) l.heads.push(...o.heads); else slots.push({ t: q.t, tup: q.tup, heads: o.heads.slice() }); });
      slots.forEach(sl => { const seen = new Set(); sl.heads = sl.heads.filter(h => !seen.has(h.inst) && seen.add(h.inst)); });
      measures.push({ sys: si, idx: measures.length, x0: xl, x1: xr, c, slots, top: sy.st.lines[0], bottom: sy.st.lines[4] });
    }
  });
  return { ok: true, skew, gray: g, w, h, S, systems, measures, padL };
}

/* 読み取り結果 → アプリの小節データ(配列)。長さ = 次の音符までの間隔(最大4分音符) */
function omrToMeasures(res, tsKey) {
  const ts = tsInfo(tsKey || "4/4"), out = [];
  res.measures.forEach(rm => {
    const m = newMeasure(tsKey || "4/4");
    ["up", "down"].forEach(voice => {
      const list = rm.slots.map(s => ({ t: s.t, tup: s.tup, insts: s.heads.map(q => q.inst).filter(i => INSTRUMENTS[i].voice === voice) })).filter(s => s.insts.length);
      list.forEach((s, i) => {
        const next = list[i + 1], gap = (next ? next.t : ts.ticks) - s.t;
        let d = s.tup ? (fitDur(Math.min(gap, 32), true) || 8) : fitDur(Math.min(gap, 48), false);
        if (!d) d = 6;
        s.insts.forEach(inst => toggleNote(m, inst, s.t, d, s.tup));
      });
    });
    out.push(m);
  });
  return out;
}
function omrCount(res) { let n = 0; res.measures.forEach(m => m.slots.forEach(s => { n += s.heads.length; })); return n; }

if (typeof module !== "undefined") {
  module.exports = Object.assign(module.exports || {}, { omrGray, omrBinarize, omrSkew, omrRotate, omrFindStaves, omrRecognize, omrToMeasures, omrCount });
}
