/* ===== omr.js : 画像の楽譜(ドラム譜)を読み取る簡易エンジン =====
 * 外部サービスを使わず、画像処理だけで「五線・小節線・符頭」を見つけ、音符データにする。
 * 流れ: 白黒化 → 傾き補正 → 五線検出 → 五線と小節線を消す → 符幹/補助線を消す
 *       → 符頭(●・×・○)を見つける → 高さでパーツを決める → 横位置から拍(tick)を決める
 * できること : 符頭の位置からパーツと拍の位置を読む(休符は自動で補われる)
 * できないこと: 音符の長さの完全な読み取り(連桁の本数だけは読んで、拍の位置の手がかりにしている)、強弱記号、連符の数字、ゴースト、文字。
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

/* ===== 文字・数字の読み取り(拍子記号・N小節休符の数・リハーサル記号・テンポ) =====
 * ブラウザの canvas で作った見本の文字と、画像から切り出した文字を、似ているかどうかで比べる(簡易)。 */
const OMR_WORDS = ["Intro", "Bass Solo", "Drum Solo", "Guitar Solo", "Verse", "Chorus", "Bridge", "Outro", "Solo", "Fill", "Coda", "Break", "Pre", "End", "Interlude", "Tag", "Ending"];
const OMR_TPL = {};
function omrVecOf(ink, x0, y0, x1, y1, W, H) {                          // 範囲内の黒を囲む最小の四角を W×H に縮めた特徴(平均0・長さ1)
  let a = x1, b = x0, c = y1, d = y0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (ink(x, y)) { if (x < a) a = x; if (x > b) b = x; if (y < c) c = y; if (y > d) d = y; }
  if (b < a || d < c) return null;
  const bw = b - a + 1, bh = d - c + 1, v = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const xa = a + Math.floor(i * bw / W), xb = a + Math.max(Math.floor(i * bw / W), Math.ceil((i + 1) * bw / W) - 1), ya = c + Math.floor(j * bh / H), yb = c + Math.max(Math.floor(j * bh / H), Math.ceil((j + 1) * bh / H) - 1);
    let n = 0, t = 0; for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) { t++; if (ink(x, y)) n++; }
    v[j * W + i] = n / Math.max(1, t);
  }
  for (let pass = 0; pass < 2; pass++) {                                 // 軽くぼかす(線の太さ・書体のちがいに強くする)
    const o = new Float32Array(v.length);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { let t = 0, n = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue; const wgt = (di === 0 && dj === 0) ? 2 : 1; t += v[jj * W + ii] * wgt; n += wgt; } o[j * W + i] = t / n; }
    v.set(o);
  }
  let m = 0; for (let i = 0; i < v.length; i++) m += v[i]; m /= v.length;
  let nr = 0; for (let i = 0; i < v.length; i++) { v[i] -= m; nr += v[i] * v[i]; } nr = Math.sqrt(nr) || 1; for (let i = 0; i < v.length; i++) v[i] /= nr;
  return { v, ar: bw / bh, a, b, c, d };
}
function omrTemplate(text, W, H) {
  const key = text + "|" + W + "x" + H; if (OMR_TPL[key] !== undefined) return OMR_TPL[key];
  const cv = document.createElement("canvas"), fs = 90; cv.width = Math.ceil(fs * 0.75 * text.length) + 40; cv.height = 140;
  const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.fillStyle = "#000"; g.font = "bold " + fs + "px 'Times New Roman','Noto Serif JP',Georgia,serif"; g.textBaseline = "alphabetic"; g.fillText(text, 20, 105);
  const d = g.getImageData(0, 0, cv.width, cv.height).data;
  return (OMR_TPL[key] = omrVecOf((x, y) => d[(y * cv.width + x) * 4] < 128, 0, 0, cv.width - 1, cv.height - 1, W, H));
}
function omrMatch(vec, cands, W, H) {                                   // 一番似ている文字と、その点数
  let best = null, bs = -9, second = -9;
  cands.forEach(t => { const tp = omrTemplate(t, W, H); if (!tp) return; let dot = 0; for (let i = 0; i < vec.v.length; i++) dot += vec.v[i] * tp.v[i]; dot -= 0.3 * Math.abs(Math.log(vec.ar / tp.ar)); if (dot > bs) { second = bs; bs = dot; best = t; } else if (dot > second) second = dot; });
  return { text: best, score: bs, margin: bs - second };
}

/* 数字1つを、形の特徴(穴の数・位置、上下の横棒、縦の棒、左上の縦線)で読む。書体がちがっても読めるようにするため。
 * 範囲 [x0..x1]×[y0..y1] に、数字1つだけが入っている前提。戻り値: { digit, holes } または null */
function omrDigitShape(ink, x0, y0, x1, y1) {
  let a = x1, b = x0, c = y1, d = y0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (ink(x, y)) { if (x < a) a = x; if (x > b) b = x; if (y < c) c = y; if (y > d) d = y; }
  if (b < a || d < c) return null;
  const bw = b - a + 1, bh = d - c + 1; if (bh < 6 || bw < 2) return null;
  const GW = 20, GH = 30, G = new Uint8Array(GW * GH);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const xa = a + Math.floor(i * bw / GW), xb = a + Math.max(Math.floor(i * bw / GW), Math.ceil((i + 1) * bw / GW) - 1), ya = c + Math.floor(j * bh / GH), yb = c + Math.max(Math.floor(j * bh / GH), Math.ceil((j + 1) * bh / GH) - 1);
    let n = 0, t = 0; for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) { t++; if (ink(x, y)) n++; }
    G[j * GW + i] = n / t >= 0.4 ? 1 : 0;
  }
  // 穴: 外側につながっていない白
  const seen = new Uint8Array(GW * GH), stack = [];
  const push = (i, j) => { if (i < 0 || j < 0 || i >= GW || j >= GH || seen[j * GW + i] || G[j * GW + i]) return; seen[j * GW + i] = 1; stack.push([i, j]); };
  for (let i = 0; i < GW; i++) { push(i, 0); push(i, GH - 1); } for (let j = 0; j < GH; j++) { push(0, j); push(GW - 1, j); }
  while (stack.length) { const [i, j] = stack.pop(); push(i + 1, j); push(i - 1, j); push(i, j + 1); push(i, j - 1); }
  const holes = []; for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    if (G[j * GW + i] || seen[j * GW + i]) continue; let n = 0, sy = 0; const st = [[i, j]]; seen[j * GW + i] = 1;
    while (st.length) { const [p, q] = st.pop(); n++; sy += q; [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => { const x = p + dx, y = q + dy; if (x >= 0 && y >= 0 && x < GW && y < GH && !G[y * GW + x] && !seen[y * GW + x]) { seen[y * GW + x] = 1; st.push([x, y]); } }); }
    if (n >= 0.04 * GW * GH) holes.push({ n, cy: sy / n / GH });
  }
  const colFrac = i => { let n = 0; for (let j = 0; j < GH; j++) n += G[j * GW + i]; return n / GH; }, rowFrac = j => { let n = 0; for (let i = 0; i < GW; i++) n += G[j * GW + i]; return n / GW; };
  let maxCol = 0, colAt = 0; for (let i = 0; i < GW; i++) if (colFrac(i) > maxCol) { maxCol = colFrac(i); colAt = i / GW; }
  let top = 0, base = 0; for (let j = 0; j <= 3; j++) top = Math.max(top, rowFrac(j)); for (let j = GH - 4; j < GH; j++) base = Math.max(base, rowFrac(j));
  const region = (i0, i1, j0, j1) => { let n = 0, t = 0; for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { t++; n += G[j * GW + i]; } return n / t; };
  const leftMid = region(0, 5, 6, 13), ur = region(13, 19, 5, 12), lr = region(12, 19, 19, 26), ll = region(0, 6, 21, 28), aspect = bw / bh;
  let digit;
  if (holes.length >= 2) digit = "8";
  else if (holes.length === 1) { let am = 0, mv = 0; for (let i = 0; i < GW; i++) { const v = colFrac(i); if (v > mv) { mv = v; am = i; } }
    const hn = holes[0].n / (GW * GH); digit = (top >= 0.85 && holes[0].cy > 0.6 && hn < 0.1) ? "5" : (hn < 0.15 && mv >= 0.95 && am >= 0.5 * GW && holes[0].cy > 0.4 && holes[0].cy < 0.6) ? "4" : holes[0].cy < 0.4 ? "9" : holes[0].cy > 0.6 ? "6" : "0"; }
  else if (aspect < 0.5 || (maxCol >= 0.9 && aspect < 0.7 && !(top >= 0.7 && colAt <= 0.3))) digit = "1";      // 縦線が左はしにあって上に横棒がある形は「5」(細い明朝体の5)
  else if (ur >= 0.5 && base >= 0.7 && (lr < 0.5 || (ur >= 0.8 && ll >= 0.7 && lr <= ll))) digit = "2";                 // 2: 右上に弧、左下からの斜め線、下の横棒
  else if (base >= 0.85 && top < 0.9 && leftMid < 0.45 && ur >= 0.3) digit = "2";
  else if (top >= 0.7 && base < 0.5) digit = leftMid >= 0.45 ? "5" : "7";
  else digit = (ur < 0.3 || leftMid >= 0.45) ? "5" : "3";
  return { digit, holes: holes.length, maxCol, top, base, leftMid, ur, lr, ll, aspect };
}

/* 範囲 [x0..x1]×[y0..y1] にある数字を左から読む。戻り値: { text, score } または null */
function omrReadDigits(ink, x0, y0, x1, y1, minGap) {
  const cols = []; for (let x = x0; x <= x1; x++) { let n = 0; for (let y = y0; y <= y1; y++) if (ink(x, y)) n++; cols.push(n > 0); }
  const segs = []; for (let i = 0; i < cols.length;) { if (!cols[i]) { i++; continue; } let j = i; while (j + 1 < cols.length) { if (cols[j + 1]) { j++; continue; } let k = j + 1; while (k < cols.length && !cols[k]) k++; if (k - j - 1 >= minGap || k >= cols.length) break; j = k; } segs.push([x0 + i, x0 + j]); i = j + 1; }
  if (!segs.length || segs.length > 3) return null;
  let text = "", sc = 9;
  for (const [a, b] of segs) {
    const r0 = omrDigitShape(ink, a, y0, b, y1); if (!r0) return null;
    const r = { text: r0.digit, score: 1 };
    text += r.text; sc = Math.min(sc, r.score);
  }
  return { text, score: sc };
}

/* 拍子記号用: 読める数字を候補に限って、書体見本との近さで読む(五線や隣の数字に重なって形がくずれても強い) */
function omrReadTsDigits(ink, x0, y0, x1, y1, minGap, cands) {
  const cols = []; for (let x = x0; x <= x1; x++) { let n = 0; for (let y = y0; y <= y1; y++) if (ink(x, y)) n++; cols.push(n > 0); }
  const segs = []; for (let i = 0; i < cols.length;) { if (!cols[i]) { i++; continue; } let j = i; while (j + 1 < cols.length) { if (cols[j + 1]) { j++; continue; } let k = j + 1; while (k < cols.length && !cols[k]) k++; if (k - j - 1 >= minGap || k >= cols.length) break; j = k; } segs.push([x0 + i, x0 + j]); i = j + 1; }
  if (!segs.length || segs.length > 2) return null;
  let text = "";
  for (let i = 0; i < segs.length; i++) {
    const v = omrVecOf(ink, segs[i][0], y0, segs[i][1], y1, 10, 16); if (!v) return null;
    const c = segs.length === 2 ? (i === 0 ? ["1"] : ["2"]) : cands;
    let best = null, bs = -9;                                       // 一番ふつうの「4」には少し加点(4/4を6/4と読みちがえにくくする)
    c.forEach(t => { const r1 = omrMatch(v, [t], 10, 16), sc = r1.score + (t === "4" ? 0.12 : 0); if (r1.text && sc > bs) { bs = sc; best = t; } });
    if (!best) return null;
    if (best === "6" || best === "9") { const sh = omrDigitShape(ink, segs[i][0], y0, segs[i][1], y1); if (sh && sh.digit === "4" && c.indexOf("4") >= 0) best = "4"; }
    text += best;
  }
  return { text };
}

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
  const inA = Math.round(y0 - 0.4 * S) - ry0, inB = Math.round(y4 + 0.4 * S) - ry0, outA = Math.round(y0 - 1.1 * S) - ry0, outA2 = Math.round(y0 - 0.6 * S) - ry0, outB = Math.round(y4 + 0.6 * S) - ry0, outB2 = Math.round(y4 + 3.8 * S) - ry0;
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
  {                                                              // 音部記号・拍子記号は、細かい隙間(0.5S)で区切った塊で調べる(最初の音符が拍子記号の一部と誤認されないように)
    const zc = [];
    for (let x = 0; x < rw; x++) if (colIn[x]) { const l = zc[zc.length - 1]; if (l && x - l.b <= 0.5 * S) { l.b = x; l.out = l.out || colOut[x]; } else zc.push({ a: x, b: x, out: colOut[x] }); }
    if (zc.length && zc[0].a < 3 * S && zc[0].b < 4 * S) {
      zoneEnd = rx0 + zc[0].b;
      for (let k = 1; k < zc.length; k++) { const c = zc[k]; if (c.a - (zoneEnd - rx0) <= 2.5 * S && !c.out && c.b - c.a <= 2.2 * S) zoneEnd = rx0 + c.b; else break; }
    }
  }

  // (4c) 途中の拍子記号: 小節線のすぐ右にある「五線の上半分と下半分の両方に数字がある」かたまり
  const y2 = st.lines[2], inkB = (x, y) => (x >= rx0 && x <= rx1 && y >= ry0 && y <= ry1) ? B[(y - ry0) * rw + (x - rx0)] === 1 : false;
  const tsLike = (a, b) => {
    let up = 0, lo = 0;
    for (let y = Math.round(y0 - 0.2 * S); y <= Math.round(y4 + 0.2 * S); y++) { let ink = 0; for (let x = a; x <= b; x++) if (inkB(rx0 + x, y)) { ink = 1; break; } if (ink) { if (y <= y2) up++; else lo++; } }
    return up >= 1.3 * S && lo >= 1.3 * S;
  };
  const zonesAt = {}, tsRead = {};
  const readTs = (xa, xb) => {                                  // 範囲内の拍子記号(上の数字/下の数字)を読む
    const clean = (x, y) => { for (const [a, b] of st.band) if (y >= a && y <= b) return bin[(a - 1) * w + x] === 1 || bin[(b + 1) * w + x] === 1; return bin[y * w + x] === 1; };   // 五線の線は、上か下が黒い所だけ数字の一部とみなす
    const topI = (x, y) => y <= y2 && y >= y0 - 0.1 * S && clean(x, y), botI = (x, y) => y >= y2 + 1 && y <= y4 + 0.5 * S && clean(x, y), gap = Math.max(1, Math.round(0.12 * S));
    const t = omrReadTsDigits(topI, xa, Math.round(y0 - 0.1 * S), xb, Math.round(y2), gap, "234567".split("")), b = omrReadTsDigits(botI, xa, Math.round(y2 + 1), xb, Math.round(y4 + 0.5 * S), gap, "248".split(""));
    if (!t || !b) return null; const key = t.text + "/" + b.text; return TIME_SIGS[key] ? key : null;
  };
  for (let m = 1; m < barX.length - 1; m++) {
    const xs = barX[m] - rx0 + 1, k = clusters.findIndex(c => c.a >= xs - 2 && c.a - xs <= 3 * S);
    if (k < 0) continue; const c0 = clusters[k];
    if (c0.out || c0.b - c0.a > 3.8 * S || !tsLike(c0.a, c0.b)) continue;
    let end = c0.b;
    for (let j = k + 1; j < clusters.length; j++) { const c = clusters[j]; if (c.a - end <= 1.2 * S && !c.out && c.b - c.a <= 2.2 * S && tsLike(c.a, c.b)) end = c.b; else break; }
    zonesAt[m] = rx0 + end; tsRead[m] = readTs(c0.a + rx0, rx0 + end);
  }
  if (zoneEnd > rx0) {                                          // 1小節目: 音部記号のあとに続く拍子記号
    const tc = clusters.filter(c => rx0 + c.b <= zoneEnd + 1 && tsLike(c.a, c.b));
    if (tc.length) tsRead[0] = readTs(rx0 + tc[0].a, rx0 + tc[tc.length - 1].b);
  }
  const inZone = x => { if (x <= zoneEnd + 0.3 * S) return true; for (const m in zonesAt) if (x >= barX[m] && x <= zonesAt[m] + 0.3 * S) return true; return false; };

  // (4d) N小節休符: 中央の線をまたぐ太い横棒。数字は五線のすぐ上
  const mrests = {};
  const thickAt = (x) => { const a = Math.round(y2 - 0.2 * S), b = Math.round(y2 + 0.2 * S); return bin[a * w + x] && bin[b * w + x]; };
  for (let m = 0; m + 1 < barX.length; m++) {
    const a0 = Math.round((m === 0 ? Math.max(barX[0], zoneEnd) : (zonesAt[m] || barX[m])) + 0.4 * S), b0 = Math.round(barX[m + 1] - 0.4 * S);
    let best = 0, bs = 0, run = 0, rs = 0;
    for (let x = a0; x <= b0; x++) { if (thickAt(x)) { if (!run) rs = x; run++; if (run > best) { best = run; bs = rs; } } else run = 0; }
    if (best >= 4 * S && best >= 0.4 * (b0 - a0)) {
      const cxm = bs + best / 2, inkA = (x, y) => x >= 0 && x < w && y >= 0 && y < h && bin[y * w + x] === 1;
      const num = omrReadDigits(inkA, Math.round(cxm - 1.3 * S), Math.round(y0 - 2.45 * S), Math.round(cxm + 1.3 * S), Math.round(y0 - 0.3 * S), Math.max(1, Math.round(0.12 * S)));
      mrests[m] = { xa: bs, xb: bs + best, count: num && +num.text >= 2 && +num.text <= 99 ? +num.text : (num && +num.text === 1 ? 1 : 0) };
    }
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
    if (inZone(rx0 + c.maxx)) continue;                                        // 音部記号・拍子記号
    if (hole && bw >= 0.65 && bw <= 1.8 && bh >= 0.55 && bh <= 1.3 && ((ry0 + (c.miny + c.maxy) / 2 - y0) / (S / 2)) >= 0.3 && hasStem(c)) heads.push({ x: cx, y: cy, kind: "oval" });     // 白い符頭(2分音符など)
  }
  // 装飾音符(フラム・ドラッグ): 本体の左にある小さな黒い玉(+短い符幹+斜線)。細い線が消えるまで縮めて、小さな芯だけ残るものを探す
  const graces = [];
  {
    const e2 = Math.max(1, Math.round(0.13 * S)), M1 = new Uint8Array(rw * rh), M2 = new Uint8Array(rw * rh), sy0 = Math.max(0, Math.round(y0 - 0.6 * S) - ry0), sy1 = Math.min(rh - 1, Math.round(y4 + 1.0 * S) - ry0);
    for (let y = sy0; y <= sy1; y++) for (let x = e2; x < rw - e2; x++) { let ok = 1; for (let d = -e2; d <= e2; d++) if (!B[y * rw + x + d]) { ok = 0; break; } M1[y * rw + x] = ok; }
    for (let y = sy0 + e2; y <= sy1 - e2; y++) for (let x = 0; x < rw; x++) { let ok = 1; for (let d = -e2; d <= e2; d++) if (!M1[(y + d) * rw + x]) { ok = 0; break; } M2[y * rw + x] = ok; }
    const sn = new Uint8Array(rw * rh), stk = [];
    for (let y = sy0; y <= sy1; y++) for (let x = 0; x < rw; x++) {
      if (!M2[y * rw + x] || sn[y * rw + x]) continue;
      let sx = 0, sy = 0, n = 0, mnx = x, mxx = x, mny = y, mxy = y; stk.length = 0; stk.push(y * rw + x); sn[y * rw + x] = 1;
      while (stk.length) { const q = stk.pop(), qy = (q / rw) | 0, qx = q - qy * rw; sx += qx; sy += qy; n++; if (qx < mnx) mnx = qx; if (qx > mxx) mxx = qx; if (qy < mny) mny = qy; if (qy > mxy) mxy = qy;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = qx + dx, ny = qy + dy; if (nx < 0 || ny < sy0 || nx >= rw || ny > sy1) continue; const r2 = ny * rw + nx; if (M2[r2] && !sn[r2]) { sn[r2] = 1; stk.push(r2); } } }
      const cw = (mxx - mnx + 1 + 2 * e2) / S, ch = (mxy - mny + 1 + 2 * e2) / S, cx = rx0 + sx / n, cy = ry0 + sy / n;
      if (cw < 0.4 || cw > 0.85 || ch < 0.3 || ch > 0.7 || inZone(cx)) continue;
      let stem = false; const yy = Math.round(sy / n - 0.7 * S);                              // 符幹: 右上に縦線(玉より細い・短い)
      if (yy >= 0) for (let xx = Math.round(sx / n + 0.1 * S); xx <= Math.min(rw - 1, Math.round(sx / n + 0.7 * S)); xx++) if (vr[yy * rw + xx] >= 0.9 * S) stem = true;
      if (!stem) continue;
      graces.push({ x: cx, y: cy, h: (cy - y0) / (S / 2) });
    }
  }
  // ×印の符頭(ハイハット・シンバル): 2本の斜めの線が交わる形を探す。×が隣とくっついていても見つけられる
  {
    const rc = Math.max(2, Math.round(0.46 * S)), rg = Math.max(2, Math.round(0.3 * S));
    const cy0 = Math.max(rc, Math.round(y0 - 1.5 * S) - ry0), cy1 = Math.round(y4 + 0.9 * S) - ry0, Dl = new Uint8Array(rw * rh), cand = [];
    for (let y = Math.max(1, cy0 - rc); y <= Math.min(rh - 2, cy1 + rc); y++) for (let x = 1; x < rw - 1; x++) {
      let v = 0; for (let dy = -1; dy <= 1 && !v; dy++) for (let dx = -1; dx <= 1; dx++) if (C[(y + dy) * rw + x + dx]) { v = 1; break; }
      Dl[y * rw + x] = v;
    }
    const ySsMin = Math.round(y0 + 1.0 * S) - ry0, ySsMax = Math.round(y0 + 2.2 * S) - ry0, yUpMax = Math.round(y0 + 0.5 * S) - ry0, yPedMin = Math.round(y4 + 0.25 * S) - ry0;   // 上声部の×は五線の上〜上端、ペダルハイハットの×は五線のすぐ下
    for (let y = cy0; y <= cy1; y++) for (let x = rc + 1; x < rw - rc - 1; x++) {
      if (y > yUpMax && y < yPedMin && !(y >= ySsMin && y <= ySsMax)) continue;
      if (inZone(rx0 + x)) continue;
      let hit = 0; for (let k = -rc; k <= rc; k++) hit += Dl[(y + k) * rw + x + k] + Dl[(y - k) * rw + x + k];
      const fr = hit / (2 * (2 * rc + 1)); if (fr < 0.8) continue;
      const gap = C[(y - rg) * rw + x] + C[(y + rg) * rw + x] + C[y * rw + x - rg] + C[y * rw + x + rg];
      if (gap > 2 || (gap === 2 && fr < 0.93)) continue;
      if (y > yUpMax && y < yPedMin && gap > 0) continue;                                  // 五線の中の×は、4方向すべてのすきまが白いものだけ(黒い符頭を×と見間違えない)
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
    const ringAround = c => {                                       // ×を丸で囲んだ ⊗ (開いたハイハット): ×の中心のまわり半径 0.5〜0.7S に輪がある
      for (let r = 0.5 * S; r <= 0.72 * S; r += 0.04 * S) {
        let n = 0; const tot = 20; for (let a = 0; a < tot; a++) { const px = Math.round(c.x + r * Math.cos(a * Math.PI / 10)), py = Math.round(c.y + r * Math.sin(a * Math.PI / 10)); if (px >= 0 && py >= 0 && px < rw && py < rh && Dl[py * rw + px]) n++; }
        if (n / tot >= 0.95) return true;
      }
      return false;
    };
    acc.forEach(c => { c.ss = c.y > yUpMax && c.y < yPedMin; c.ped = c.y >= yPedMin; c.ring = !c.ped && c.y - Math.round(0.4 * S) >= Math.round(y0 - 1.5 * S) - ry0 - 1 && (ringOf(c) || (ringAround(c) && { x: c.x, y: c.y })); if (c.ring) rcache.push(c.ring); });
    const accF = acc.filter(c => c.ring || !rcache.some(r => Math.abs(r.x - c.x) < 0.7 * S && Math.abs(r.y - c.y) < 0.7 * S));
    accF.forEach(c => {
      let stem = false;
      if (c.ped) { const yy = c.y + Math.round(0.9 * S); if (yy < rh) for (let xx = Math.max(0, Math.round(c.x - 0.9 * S)); xx <= Math.min(rw - 1, Math.round(c.x + 0.2 * S)); xx++) if (vr[yy * rw + xx] >= 1.9 * S) stem = true; }   // ペダルの×は符幹が左下にのびる
      else { const yy = c.y - Math.round(0.8 * S); if (yy >= 0 && yy < rh) for (let xx = Math.max(0, Math.round(c.x + 0.1 * S)); xx <= Math.min(rw - 1, Math.round(c.x + 0.9 * S)); xx++) if (vr[yy * rw + xx] >= (c.ss ? 2.6 : 1.7) * S) stem = true; }   // 上声部の×は符幹が右上にのびる(下からくるキックの符幹・休符は除く)
      if (c.ped && stem) { let up = false, dn = false; const ya = c.y - Math.round(0.9 * S), yb = c.y + Math.round(1.6 * S); for (let xx = Math.max(0, Math.round(c.x - 0.9 * S)); xx <= Math.min(rw - 1, Math.round(c.x + 0.2 * S)); xx++) { if (ya >= 0 && vr[ya * rw + xx] >= 1.0 * S) up = true; if (yb < rh && vr[yb * rw + xx] >= 0.3 * S) dn = true; } if (up || !dn) stem = false; }   // ペダルの×は符幹の先端にある。上にも縦線がのびていれば、旗や休符を×と見間違えたもの
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
    if (!E[y * rw + x] || seen[y * rw + x] || inZone(rx0 + x)) continue;
    let sx = 0, sy = 0, n = 0, minx = x, maxx = x, miny = y, maxy = y; stack.length = 0; stack.push(y * rw + x); seen[y * rw + x] = 1;
    while (stack.length) {
      const q = stack.pop(), qy = (q / rw) | 0, qx = q - qy * rw; sx += qx; sy += qy; n++;
      if (qx < minx) minx = qx; if (qx > maxx) maxx = qx; if (qy < miny) miny = qy; if (qy > maxy) maxy = qy;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = qx + dx, ny = qy + dy; if (nx < 0 || ny < by0 || nx >= rw || ny > by1) continue; const r2 = ny * rw + nx; if (E[r2] && !seen[r2]) { seen[r2] = 1; stack.push(r2); } }
    }
    const cw = maxx - minx + 1, ch = maxy - miny + 1;
    if (n >= 0.06 * S * S && cw <= 1.3 * S && ch > 1.1 * S && ch + 2 * er <= 3.5 * S) {   // 和音で縦につながった符頭(1スペースずつずれた丸が重なる): 個数ぶんに分ける
      const Ho = ch + 2 * er, k = Math.max(2, Math.round((Ho - 0.9 * S) / S) + 1), c = { minx: Math.round(minx - er), maxx: Math.round(maxx + er), miny: Math.round(miny - er), maxy: Math.round(maxy + er) };
      if (hasStem(c) || k >= 2) for (let j = 0; j < k; j++) {
        const oy = ry0 + miny - er + 0.45 * S + j * (Ho - 0.9 * S) / (k - 1), ox = rx0 + sx / n, hh = (oy - y0) / (S / 2);
        if (hh >= 0.3 && hh <= 8.6 && !heads.some(q => Math.abs(q.x - ox) < 0.3 * S && Math.abs(q.y - oy) < 0.6 * S)) heads.push({ x: ox, y: oy, kind: "oval" });
      }
      continue;
    }
    if (n < 0.06 * S * S || cw > 1.3 * S || ch > 1.1 * S) continue;
    const c = { minx: Math.round(minx - er), maxx: Math.round(maxx + er), miny: Math.round(miny - er), maxy: Math.round(maxy + er) };
    const hh = (ry0 + sy / n - y0) / (S / 2), ox = rx0 + sx / n, oy = ry0 + sy / n;
    if (heads.some(q => q.kind === "cross" && Math.abs(q.x - ox) < 0.7 * S && Math.abs(q.y - oy) < 0.9 * S)) continue;
    if (hh >= 0.3 && hh <= 8.6 && hasStem(c)) heads.push({ x: rx0 + sx / n, y: ry0 + sy / n, kind: "oval" });
  }
  // (7) パーツの決定: 形(×/丸)と五線上の高さ(半スペース単位 h)から
  const CROSS = [["crash", -2], ["hh_close", -1], ["ride", 0], ["sidestick", 3], ["hh_pedal", 9]], OVAL = [["hi_tom", 1], ["snare", 3], ["low_tom", 5], ["kick", 7]];
  heads.forEach(hd => {
    hd.h = (hd.y - y0) / (S / 2);
    const tab = hd.kind === "cross" ? CROSS : OVAL; let best = tab[0];
    tab.forEach(t => { if (Math.abs(t[1] - hd.h) < Math.abs(best[1] - hd.h) - 1e-9) best = t; });
    hd.inst = best[0];
    if (hd.kind === "oval" && hd.h > 6) hd.inst = "kick";
    if (hd.kind === "cross" && hd.inst === "hh_close" && (hd.ring || rings.some(r => Math.abs(r.cx - hd.x) < 0.9 * S && r.cy < hd.y && hd.y - r.cy < 2 * S))) hd.inst = "hh_open";
  });
  // (8) 付点: 符頭の右どなりにある小さな黒い点(まわりに他の黒がない)
  {
    const r = Math.max(1, Math.floor(0.09 * S)), solidDot = (px, py) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + 1 && !inkB(px + dx, py + dy)) return false; return true; };
    const ringClear = (px, py) => { let n = 0, t = 0; for (let a = 0; a < 16; a++) { t++; if (inkB(Math.round(px + (r + 2) * Math.cos(a * Math.PI / 8)), Math.round(py + (r + 2) * Math.sin(a * Math.PI / 8)))) n++; } return n <= 1; };
    heads.forEach(hd => {
      const hw = hd.kind === "cross" ? 0.45 * S : 0.6 * S; let found = false;
      for (let dy = -0.7 * S; dy <= 0.35 * S && !found; dy += 1) for (let dx = hw + 0.25 * S; dx <= hw + 1.0 * S && !found; dx += 1) {
        const px = Math.round(hd.x + dx), py = Math.round(hd.y + dy); if (solidDot(px, py) && ringClear(px, py)) found = true;
      }
      if (found) hd.dot = true;
    });
  }
  // 装飾音の確定: 普通の符頭ではなく、五線の中にあり、すぐ右(0.8〜2.6スペース)に同じような高さの本体の音符があるもの
  for (let k = graces.length - 1; k >= 0; k--) {
    const g = graces[k];
    const near = heads.some(q => Math.abs(q.x - g.x) < 0.9 * S && Math.abs(q.y - g.y) < 0.9 * S);
    const main = heads.filter(q => q.kind === "oval" && q.x - g.x >= 0.8 * S && q.x - g.x <= 2.6 * S && Math.abs(q.y - g.y) <= 1.3 * S).sort((a, b) => a.x - b.x)[0];
    if (near || g.h < -0.5 || g.h > 7.5 || !main) { graces.splice(k, 1); continue; }
    g.main = main;
  }
  graces.sort((a, b) => a.x - b.x);
  // バズロール(ロールの斜線)の偽の×: 丸い符頭のすぐ右上(符幹の位置)にある×で、五線の外か上端にあるもの
  for (let k = heads.length - 1; k >= 0; k--) {
    const q = heads[k]; if (q.kind !== "cross") continue;
    if (heads.some(o => o.kind === "oval" && o.x < q.x - 0.2 * S && q.x - o.x <= 0.8 * S && o.y - q.y >= 0.9 * S && o.y - q.y <= 2.6 * S && !heads.some(z => z !== q && z.kind === "cross" && Math.abs(z.x - o.x) < 0.3 * S))) heads.splice(k, 1);
  }
  // (9) 休符: 符頭・符幹・旗・連桁・付点のどれでもない、五線の中にあるかたまり。拍の位置を決める手がかり(音符と同じく、その分だけ右に次の拍がある)
  const rests = [];
  {
    const yTop = Math.round(y0 - 0.3 * S), yBot = Math.round(y4 + 0.6 * S), stemXs = [];
    for (let x = 0; x < rw; x++) { for (let y = Math.max(0, yTop - ry0 - Math.round(2 * S)); y <= Math.min(rh - 1, yBot - ry0 + Math.round(2 * S)); y++) if (B[y * rw + x] && !C[y * rw + x] && vr[y * rw + x] >= 1.7 * S) { stemXs.push(rx0 + x); break; } }
    for (const c of comps) {
      const bw = c.w / S, bh = c.h / S, cx = rx0 + (c.minx + c.maxx) / 2, cy = ry0 + (c.miny + c.maxy) / 2;
      if (c.area < 0.22 * S * S || bw < 0.5 || bw > 1.8 || bh < 0.35 || bh > 3.4) continue;
      if (cy < yTop || cy > yBot || inZone(rx0 + c.maxx)) continue;
      if (heads.some(q => Math.abs(q.x - cx) < 0.75 * S && Math.abs(q.y - cy) < 1.0 * S) || rings.some(q => Math.abs(q.cx - cx) < 0.75 * S && Math.abs(q.cy - cy) < 1.0 * S)) continue;
      if (graces.some(g => Math.abs(g.x - cx) < 0.9 * S && Math.abs(g.y - cy) < 1.5 * S)) continue;      // 装飾音の符幹・斜線
      const L = rx0 + c.minx; if (stemXs.some(sx => sx >= L - 0.45 * S && sx <= L + 0.25 * S)) continue;      // 符幹にくっついた旗
      rests.push({ x: cx, y: cy, w: c.w, h: c.h, L, R: rx0 + c.maxx, up: cy < st.lines[2], dn: cy >= st.lines[2] - 0.3 * S, half: c.w >= 1.5 * c.h && cy > y0 + 1.4 * S && cy < st.lines[2] });
    }
    const r0 = Math.max(1, Math.floor(0.09 * S)), rg0 = Math.max(r0 + 2, Math.round(0.33 * S));                          // 付点休符: 右どなりの小さな黒い点
    const solid = (px, py) => { for (let dy = -r0; dy <= r0; dy++) for (let dx = -r0; dx <= r0; dx++) if (dx * dx + dy * dy <= r0 * r0 + 1 && !inkB(px + dx, py + dy)) return false; return true; };
    const clear = (px, py) => { let n = 0; for (let a = 0; a < 16; a++) if (inkB(Math.round(px + rg0 * Math.cos(a * Math.PI / 8)), Math.round(py + rg0 * Math.sin(a * Math.PI / 8)))) n++; return n <= 1; };
    rests.forEach(r => { for (let dy = -0.9 * S; dy <= 0.5 * S && !r.dot; dy += 1) for (let dx = r.R - r.x + 0.15 * S; dx <= r.R - r.x + 0.9 * S && !r.dot; dx += 1) { const px = Math.round(r.x + dx), py = Math.round(r.y + dy); if (solid(px, py) && clear(px, py)) r.dot = true; } });
    rests.sort((a, b) => a.x - b.x);                                       // 同じ休符が2つに割れたもの・2声部の休符は1つにまとめる
    for (let i = rests.length - 1; i > 0; i--) if (rests[i].x - rests[i - 1].x <= 0.6 * S) { const a = rests[i - 1], b = rests[i]; a.dot = a.dot || b.dot; a.up = a.up || b.up; a.dn = a.dn || b.dn; a.x = (a.x + b.x) / 2; a.R = Math.max(a.R, b.R); rests.splice(i, 1); }
  }
  // 繰り返し記号: 小節線のそばに、2・3間と3・4間(中央の2つのすきま)の黒い点が縦に2つ並ぶ。左側 = 終わり(:‖)、右側 = はじまり(‖:)
  const repEnd = [], repStart = [];
  {
    const r1 = Math.max(1, Math.floor(0.1 * S)), yA = Math.round(y0 + 1.5 * S), yB = Math.round(y0 + 2.5 * S);
    const disc = (px, py) => { for (let dy = -r1; dy <= r1; dy++) for (let dx = -r1; dx <= r1; dx++) if (dx * dx + dy * dy <= r1 * r1 + 1 && !inkB(px + dx, py + dy)) return false; return true; };
    const pair = px => disc(px, yA) && disc(px, yB) && !inkB(px, Math.round(y0 + 0.5 * S)) && !inkB(px, Math.round(y4 - 0.5 * S));
    const full = x => { let n = 0; for (let y = Math.round(y0); y <= Math.round(y4); y++) n += bin[y * w + x]; return n >= (y4 - y0) * 0.95; };
    for (let k = 1; k < barX.length; k++) {
      const x = Math.round(barX[k]); let lo = x, hi = x; for (let d = 0; d <= Math.round(1.3 * S); d++) { if (full(x - d)) lo = x - d; if (full(x + d)) hi = x + d; }
      let e = false, s0 = false; const thick = hi - lo + 1 >= 0.3 * S;                      // 繰り返しの小節線は、太い線をふくむ
      if (thick) for (let d = Math.round(0.25 * S); d <= Math.round(1.3 * S) && !(e && s0); d++) { if (!e && pair(lo - d)) e = true; if (!s0 && k + 1 < barX.length && pair(hi + d)) s0 = true; }
      repEnd[k] = e; repStart[k] = s0;
    }
  }
  heads.forEach(q => { const b = omrBeamInfo(bin, w, h, q, S); q.nb = b.nb; q.sd = b.dir; });
  return { st, barX, repEnd, repStart, heads, graces, rests, zoneEnd, zonesAt, tsRead, mrests, S };
}


/* ---- 連桁(符尾の横線)の本数: 符頭の符幹をたどり、先端の横線を数える。0=4分以上 / 1=8分 / 2=16分 / 3=32分 ---- */
function omrBeamInfo(bin, w, h, q, S) {
  let best = null;
  for (const dir of [-1, 1]) {                                       // -1: 符幹が上へ / 1: 下へ
    const wd = q.kind === "cross" ? 1.0 : 0.8, xa = dir < 0 ? q.x + (q.kind === "cross" ? -0.2 : 0.3) * S : q.x - wd * S, xb = dir < 0 ? q.x + wd * S : q.x + (q.kind === "cross" ? 0.2 : -0.3) * S;
    for (let x = Math.round(xa); x <= Math.round(xb); x++) {
      if (x < 1 || x >= w - 1) continue;
      let y = Math.round(q.y), gap = 0, L = 0, lead = 0, started = false;
      while (y > 0 && y < h - 1 && (started ? gap <= (q.kind === "cross" ? Math.max(1, Math.round(0.28 * S)) : 1) : lead <= 0.7 * S)) { y += dir; if (bin[y * w + x]) { gap = 0; L++; started = true; } else if (started) gap++; else lead++; }
      const tip = y - dir * gap;
      if (L >= 1.3 * S && (!best || L > best.L)) best = { L, x, tip, dir };
    }
  }
  if (!best) return { nb: 0, dir: 0 };
  let nb = 0;
  for (const side of [-1, 1]) {
    const cx = Math.round(best.x + side * 0.55 * S); if (cx < 0 || cx >= w) continue;
    const minRun = Math.max(2, Math.round(0.16 * S)), runs = []; let start = -1;
    for (let k = 0; k <= Math.round(2.2 * S); k++) {
      const y = Math.round(best.tip - best.dir * k), on = y >= 0 && y < h && bin[y * w + cx] === 1;
      if (on && start < 0) start = k; if (!on && start >= 0) { runs.push([start, k - 1]); start = -1; }
    }
    if (start >= 0) runs.push([start, Math.round(2.2 * S)]);
    let n = 0, last = -1;                                           // 先端から途切れずに(すきま0.35S以内で)重なる横線だけ数える(ロールの斜線やタイは除く)
    for (const [a0, a1] of runs) { const len = a1 - a0 + 1; if (len < minRun || len > 0.75 * S) continue; if (last < 0 ? a0 > 0.3 * S : a0 - last > 0.35 * S) break; n++; last = a1; }
    nb = Math.max(nb, n);
  }
  return { nb: Math.min(3, nb), dir: best.dir, tip: best.tip, x: best.x };
}

/* ---- 横位置 → 拍(tick) ---- */
/* xs: 小さい順の音符の横位置。c: 小節の左端(基準)。W: 小節の幅。T: 小節のtick数。padL: 左の余白の目安 */
function omrQuantizeLin(xs, c, W, T, S, padL, first, noTup) {
  const n = xs.length; if (!n) return [];
  const X0e = c + padL, k0 = Math.max(0.0001, (W - padL - 0.6 * S) / T);
  const grids = [{ g: 24, tup: false, pen: 0 }, { g: 12, tup: false, pen: 0.05 }, { g: 16, tup: true, pen: 0.07 }, { g: 6, tup: false, pen: 0.14 }, { g: 8, tup: true, pen: 0.16 }];
  let best = null;
  for (const gr of grids) if (!(noTup && gr.tup)) for (let dx = -0.9; dx <= (first ? 3.8 : 0.9) + 0.0001; dx += 0.15) for (let kk = 0.8; kk <= 1.2001; kk += 0.015) {
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
      if (noTup && gr.tup) continue;
      const e = ps.reduce((a, p) => a + Math.abs(p / gr.g - Math.round(p / gr.g)), 0) / ps.length + gr.pen;
      if (!bg || e < bg.e - 1e-9) bg = { e, gr };
    }
    pick[b] = bg.gr;
  });
  const res = tfs.map(o => {
    const gr = pick[o.beat], p = o.tf - o.beat * 48; let q = Math.round(p / gr.g) * gr.g;
    if (q >= 48) return { t: Math.max(0, Math.min(T - 6, (o.beat + 1) * 48)), tup: false };        // 次の拍の頭に丸められた
    if (q < 0) q = 0;
    return { t: Math.max(0, Math.min(T - 6, o.beat * 48 + q)), tup: gr.tup };
  });
  let rs = 0; res.forEach((r, i) => { rs += Math.abs(xs[i] - best.X0 - best.k * r.t); });       // 当てはめの残り(px): 音符の間隔が音価に比例しない楽譜との比較用
  res.resid = rs / S; return res;
}

/* 音符の間隔が音価に比例しない楽譜(4分の間隔 > 8分の間隔×2 など)用: 隣どうしの間隔 ≒ G×(音価/4分)^p として、tick を動的計画法で決める */
function omrQuantizeDP(xs, T, S, xr, dots, x0, noTup, no32) {
  const n = xs.length; if (n < 3) return null;
  const st = [], pen = []; for (let t = 0; t < T; t += 2) {
    let pn = -1; if (t % 24 === 0) pn = 0; else if (t % 12 === 0) pn = 0.05; else if (t % 16 === 0) pn = 0.07; else if (t % 6 === 0) pn = 0.14; else if (t % 8 === 0) pn = 0.16;
    if (pn >= 0 && !(noTup && t % 8 === 0 && t % 6 !== 0) && !(no32 && t % 12 !== 0 && t % 8 !== 0)) { st.push(t); pen.push(pn); }
  }
  const m = st.length, isTup = t => t % 8 === 0 && t % 6 !== 0, isStr = t => t % 6 === 0 && t % 8 !== 0;
  let best = null;
  for (const p of [1, 0.85, 0.7, 0.6, 0.5, -0.25, -0.4]) for (let G = 2.4 * S; G <= 7.2 * S; G += 0.3 * S) {      // p<0: 音価の2倍ごとに間隔が一定の割合ずつ増える(MuseScoreの組版)
    const gap = new Float64Array(T + 1); for (let d = 1; d <= T; d++) gap[d] = p > 0 ? G * Math.pow(d / 48, p) : G * Math.max(0.2, 1 - p * Math.log2(d / 48));
    let prev = new Float64Array(m), bp = []; for (let a = 0; a < m; a++) prev[a] = pen[a] + (x0 === undefined ? 0.35 * st[a] / 24 : Math.abs((xs[0] - x0) - (st[a] > 0 ? gap[st[a]] : 0)) / S * 0.5 + 0.03 * st[a] / 24);   // 頭の余白が広いぶんは、小節の頭の休符として数える
    for (let i = 1; i < n; i++) {
      const cur = new Float64Array(m).fill(1e9), bk = new Int16Array(m).fill(-1), dx = xs[i] - xs[i - 1];
      for (let a = 0; a < m; a++) { if (prev[a] >= 1e9) continue; for (let b = a + 1; b < m; b++) {
        const d = st[b] - st[a]; if (d < 6) continue; const dd = d === 18 || d === 36 || d === 72 || d === 144, dt0 = dots && dots[i - 1] ? (dd ? -0.15 : 0.35) : (dd ? 0.25 : 0); const e = Math.abs(dx - gap[d]) / S * 0.5 + pen[b] + dt0, v = prev[a] + e;
        if (v < cur[b]) { cur[b] = v; bk[b] = a; } } }
      bp.push(bk); prev = cur;
    }
    let bi = -1, bv = 1e9; for (let a = 0; a < m; a++) { if (st[a] > T - 6) continue; const v = prev[a] + Math.abs((xr - xs[n - 1]) - Math.max(gap[T - st[a]] - 0.5 * S, 2.0 * S)) / S * 0.5; if (v < bv) { bv = v; bi = a; } }   // 最後の音から小節線までの間隔も音価に合わせる
    if (bi < 0) continue; bv += 0.08 * Math.abs(1 - Math.abs(p)) * n;
    if (!best || bv < best.cost) { const seq = [bi]; for (let i = n - 2; i >= 0; i--) seq.unshift(bp[i][seq[0]]); best = { cost: bv, seq: seq.map(a => st[a]) }; }
  }
  if (!best) return null;
  const ts = best.seq; for (let i = 0; i < n; i++) { const b = Math.floor(ts[i] / 48); if (ts.some((u, j) => Math.floor(u / 48) === b && ((isTup(ts[i]) && isStr(u)) || (isStr(ts[i]) && isTup(u))))) return null; }   // 同じ拍に3連符と2分割が混ざる解は使わない
  return { res: ts.map(t => ({ t, tup: isTup(t) })), cost: best.cost };
}

function omrQuantize0(xs, c, W, T, S, padL, first, dots) {
  const lin = omrQuantizeLin(xs, c, W, T, S, padL, first); if (!lin.length) return lin;
  const dupOf = r => r.some((q, i) => i > 0 && q.t === r[i - 1].t);
  if (dupOf(lin)) {                                                                    // 別々の音が同じ拍になってしまう = 16分音符のずれを8分に丸めている
    const dpx = omrQuantizeDP(xs, T, S, c + W, dots || xs.map(() => false), first ? undefined : c + padL, true);
    if (dpx && !dupOf(dpx.res) && !dpx.res.some(r => r.tup) && dpx.cost / xs.length < 0.15) return dpx.res;
    const dp16 = omrQuantizeDP(xs, T, S, c + W, dots || xs.map(() => false), first ? undefined : c + padL, true, true);   // 32分音符を使わない(16分までの)読み: 装飾音のぶんだけ右にずれても、16分の連続として読める
    if (dp16 && !dupOf(dp16.res) && dp16.cost / xs.length < 0.22) return dp16.res;
  }
  if (lin.some(r => !r.tup && r.t % 12 !== 0)) {                                       // 32分音符の位置(6の倍数)に丸められた = 格子が合っていない。16分までの読みがよく合うならそちらにする
    const dps = omrQuantizeDP(xs, T, S, c + W, dots || xs.map(() => false), first ? undefined : c + padL, true);
    if (dps && !dps.res.some(r => r.t % 12 !== 0 && r.t % 8 !== 0) && !dupOf(dps.res) && dps.cost / xs.length < 0.15) return dps.res;
  }
  const linTup = lin.some(r => r.tup), n = lin.length, anyDot = dots && dots.some(Boolean), isD = d => d === 18 || d === 36 || d === 72 || d === 144;
  if (anyDot) {                                                                         // 付点が見つかった小節: 付点のある音の次までの長さが付点音価になる解を選ぶ
    const agree = r => r.reduce((a, q, i) => a + (i + 1 < r.length && dots[i] && isD(r[i + 1].t - q.t) ? 1 : 0) - (i + 1 < r.length && !dots[i] && isD(r[i + 1].t - q.t) ? 1 : 0), 0);
    const dpd = omrQuantizeDP(xs, T, S, c + W, dots, first ? undefined : c + padL);
    if (dpd && !dpd.res.some(r => r.tup) && dpd.cost / n < 0.3 && agree(dpd.res) > agree(lin)) return dpd.res;
  }
  const undotted = r => r.reduce((a, q, i) => a + (i + 1 < r.length && !(dots && dots[i]) && isD(r[i + 1].t - q.t) ? 1 : 0), 0);
  if (!linTup && undotted(lin) > 0) {                                                    // 付点がないのに付点の長さになる読みは、間隔が音価に比例しないだけのことが多い
    const dpu = omrQuantizeDP(xs, T, S, c + W, dots || xs.map(() => false), first ? undefined : c + padL);
    if (dpu && !dpu.res.some(r => r.tup) && dpu.cost / n < 0.2 && undotted(dpu.res) < undotted(lin)) return dpu.res;
  }
  if (!linTup && lin.resid / n < 0.35 && lin[0].t === 0) return lin;                                       // 十分合っているときは今まで通り
  const dp = omrQuantizeDP(xs, T, S, c + W, undefined, first ? undefined : c + padL); if (!dp) return lin;
  const dpTup = dp.res.some(r => r.tup);
  if (linTup) {
    const cnt = {}; lin.forEach(r => { if (r.tup) { const b = Math.floor(r.t / 48); cnt[b] = (cnt[b] || 0) + 1; } });
    if (Object.values(cnt).some(v => v >= 3) && lin.resid / n < 0.25) {
      const dpn = lin.resid / n > 0.13 ? omrQuantizeDP(xs, T, S, c + W, dots || xs.map(() => false), first ? undefined : c + padL, true) : null;   // 等間隔の3つ = 3連符にも16分の連続にも見える。3連符でない読みがはっきり合うなら、そちらを取る
      return dpn && dpn.cost / n < 0.1 && dpn.cost < 0.5 * lin.resid ? dpn.res : lin;
    }                                // 1拍に3つ以上そろった本物の3連符
    if (!dpTup && dp.cost / n < 0.15) return dp.res;
    const l2 = omrQuantizeLin(xs, c, W, T, S, padL, first, true);                           // 3連符でなくても同じくらい合うなら、2分割として読む(3連符は1拍に3つそろうのがふつう)
    if (dupOf(l2)) { const dpx = omrQuantizeDP(xs, T, S, c + W, dots || xs.map(() => false), first ? undefined : c + padL, true); if (dpx && !dupOf(dpx.res) && dpx.cost / n < 0.15) return dpx.res; }
    return l2.resid - lin.resid < 0.14 * n ? l2 : lin;
  }                        // 3連符に見えても、間隔が音価に比例しないだけの場合は2分割として読む
  if (lin.resid / n < 0.35) return dp.cost / n < 0.2 && !dpTup && dp.res[0].t === 0 ? dp.res : lin;     // 小節の頭に音がないと読んだときだけ見直す
  return !dpTup && dp.cost / n < 0.2 && dp.cost < lin.resid * 0.25 ? dp.res : lin;
}


/* 連桁の本数(nbs: 各音の本数, 0=不明)から決まる「次の音までの長さの上限」を守っているかを数える。守れていない読みは、別の読み方と比べて選びなおす */
function omrQuantize(xs, c, W, T, S, padL, first, dots, nbs) {
  const r0 = omrQuantize0(xs, c, W, T, S, padL, first, dots); if (!nbs || !r0.length) return r0;
  const viol = r => { let v = 0; for (let i = 0; i + 1 < r.length; i++) { const nb = nbs[i]; if (!nb) continue; const lim = 48 / Math.pow(2, nb) * (dots && dots[i] ? 1.5 : 1) * 1.55 + 1, g = r[i + 1].t - r[i].t; if (r[i].tup || r[i + 1].tup) { if (g > lim * 1.4) v++; } else if (g > lim) v++; } return v; };
  {                                                                   // 連桁の本数がすべて分かる小節: 各音の長さ(8分=24, 16分=12…)を足していくと、最後の音がちょうど小節の終わりに届く → その読みを採る
    const n = r0.length, dur = i => { if (!nbs[i]) return 0; let b = 48 / Math.pow(2, nbs[i]); if (nbs[i] >= 3 && !(i + 1 < n && Math.abs(r0[i + 1].t - r0[i].t - 6) <= 2)) b = 12;     // 3本は読み違いのことが多い(32分は、隣との間隔も6のときだけ)
       return dots && dots[i] && i + 1 < n && Math.abs(r0[i + 1].t - r0[i].t - 1.5 * b) <= 3 ? 1.5 * b : b; }, t = [r0[0].t];
    const hasTup = r0.some(q => q.tup);
    if (n >= 3 && nbs[n - 1] > 0) {
      const starts = [r0[0].t]; if (r0[0].t > 0 && xs[0] - c <= padL + 0.8 * S) starts.push(0);       // 小節の頭のすぐ右にある最初の音は、0 から始まるかもしれない
      const found = [];                                                // 次の音が連桁のない別の声(バスドラムなど)のときは、間隔が「今までの読み」か「その音価いっぱい」かの両方を試す
      const walk = (i, t) => {
        if (found.length > 64) return;
        if (i + 1 === n) { if (Math.abs(t[i] + dur(i) - T) <= 6 && t[i] <= T - 6) found.push(t.slice()); return; }
        const d = dur(i), g = Math.max(6, r0[i + 1].t - r0[i].t);
        const opts = d && nbs[i + 1] ? [d] : d ? [...new Set([Math.min(d, g), d])] : [g];
        for (const o of opts) { t.push(t[i] + o); walk(i + 1, t); t.pop(); }
      };
      starts.forEach(t0 => walk(0, [t0]));
      let best = null;
      found.forEach(t => {
        if (!t.every((v, i) => Math.abs(v - r0[i].t) <= 24 && v % 12 === 0)) return;
        const moved = t.reduce((a, v, i) => a + (v !== r0[i].t || r0[i].tup ? 1 : 0), 0); if (!moved) return;
        const known = nbs.filter((v, i) => v > 0 && i + 1 < n).length, agree = nbs.reduce((a, v, i) => a + (v > 0 && i + 1 < n && Math.abs(r0[i + 1].t - r0[i].t - dur(i)) <= 6 ? 1 : 0), 0);
        const shifted = t[0] !== r0[0].t;
        if (!(hasTup || shifted ? known >= 0.75 * (n - 1) : known >= 0.6 * (n - 1) && agree >= 0.6 * known)) return;
        const cost = t.reduce((a, v, i) => a + Math.abs(v - r0[i].t), 0) - 6 * t.filter(v => v % 24 === 0).length;
        if (!best || cost < best.cost) best = { cost, t };
      });
      if (best) {
        return best.t.map(v => ({ t: v, tup: false }));
      }
    }
  }
  if (r0.some(q => q.tup)) {                                           // 3連符なら、組の音の連桁の本数はそろうはず。そろわない(8分と16分が混ざる)なら、3連符ではなく16分の並びとして読みなおす
    const nbT = nbs.filter((v, i) => r0[i].tup && v > 0);
    if (nbT.length >= 2 && new Set(nbT).size > 1) {
      const d16 = omrQuantizeDP(xs, T, S, c + W, dots || xs.map(() => false), first ? undefined : c + padL, true, true);
      if (d16 && !d16.res.some((q, i) => i > 0 && q.t === d16.res[i - 1].t) && d16.cost / xs.length < 0.25) return d16.res;
    }
  }
  const v0 = viol(r0); if (!v0) return r0;
  const x0 = first ? undefined : c + padL, dd = dots || xs.map(() => false), cands = [];
  [[dd, true, true], [dd, true, false], [dd, false, false], [undefined, false, false]].forEach(([dt, nt, n32]) => { const d = omrQuantizeDP(xs, T, S, c + W, dt, x0, nt, n32); if (d) cands.push({ res: d.res, cost: d.cost / xs.length }); });
  const l2 = omrQuantizeLin(xs, c, W, T, S, padL, first, true); cands.push({ res: l2, cost: l2.resid / xs.length });
  let best = { res: r0, v: v0, cost: -1 };
  cands.forEach(cd => { const v = viol(cd.res), dup = cd.res.some((q, i) => i > 0 && q.t === cd.res[i - 1].t); if (dup) return; if (v < best.v || (v === best.v && best.cost >= 0 && cd.cost < best.cost - 0.02)) best = { res: cd.res, v, cost: cd.cost }; });
  return best.res;
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
  const measures = []; let tsCur = opt.ts && TIME_SIGS[opt.ts] ? opt.ts : "4/4", tsFound = null, bpm = null;
  systems.forEach((sy, si) => {
    const clefEnd = Math.max(sy.barX[0], sy.zoneEnd), boxes = omrFindBoxes(bin, w, h, sy.st);
    if (si === 0) bpm = omrFindTempo(bin, w, sy.st, boxes);
    const markOf = {};                                           // 小節番号(段の中) → リハーサル記号
    boxes.forEach(bx => {
      const text = omrReadMark(bin, w, bx); if (!text) return; const cx = (bx.xa + bx.xb) / 2; let mi = -1, bd = 3 * S;
      sy.barX.forEach((x, i) => { if (i + 1 < sy.barX.length && Math.abs(x - cx) <= bd) { bd = Math.abs(x - cx); mi = i; } });
      if (mi < 0) sy.barX.forEach((x, i) => { if (i + 1 < sy.barX.length && bx.xa - x >= -0.5 * S && bx.xa - x <= 2.5 * S) mi = i; });
      if (mi >= 0) markOf[mi] = text;
    });
    for (let m = 0; m + 1 < sy.barX.length; m++) {
      const xl = sy.barX[m], xr = sy.barX[m + 1]; if (xr - xl < 2.5 * S) continue;
      const spurious = m > 0 && !!sy.zonesAt[m] && (sy.tsRead[m] === tsCur || (!sy.tsRead[m] && sy.zonesAt[m] - sy.barX[m] < 2.3 * S));   // 同じ拍子が出てきた/読めない狭いかたまり = 休符などを拍子記号と見間違えた
      if (sy.tsRead[m] && !spurious) { tsCur = sy.tsRead[m]; if (!tsFound) tsFound = tsCur; }
      const T = tsInfo(tsCur).ticks, zoneEndM = m === 0 ? clefEnd : (sy.zonesAt[m] && !spurious ? sy.zonesAt[m] : 0);
      const c = Math.max(m === 0 ? clefEnd : xl, zoneEndM), W = xr - c, mr = sy.mrests[m];
      const hs = mr ? [] : sy.heads.filter(q => q.x > c && q.x < xr).sort((a, b) => a.x - b.x);
      const onsets = [];                                           // 近い x を同じ拍(和音)にまとめる
      hs.forEach(q => { const l = onsets[onsets.length - 1]; if (l && q.x - l.x <= 0.6 * S) { l.heads.push(q); l.x = (l.x * (l.heads.length - 1) + q.x) / l.heads.length; } else onsets.push({ x: q.x, heads: [q] }); });
      // 休符も「拍の位置」の手がかりとして混ぜる(音符のない所で拍が進んでいる分、間隔の解釈が正しくなる)
      const evs = onsets.map((o, oi) => { const gs = (sy.graces || []).filter(g => o.heads.includes(g.main)); const gx = gs.length ? Math.min(...gs.map(g => g.x)) : null;
        return { x: o.x, o, qx: oi === 0 && gx !== null && o.x - gx < 3 * S ? gx + 0.5 * S : o.x }; });   // 小節の最初の音に装飾音がついているとき、装飾音のぶん右にずれるので、装飾音の位置を基準に拍を決める
      if (!mr) (sy.rests || []).forEach(r => { if (r.x <= c || r.x >= xr) return; if (r.w >= 1.8 * r.h && Math.abs(r.x - (xl + xr) / 2) <= 0.7 * S) return;   // 全休符(小節の真ん中の四角)は拍の位置を表さない
       const e = evs.find(e => Math.abs(e.x - r.x) <= 0.6 * S); if (e) { if (!e.o) { e.dot = e.dot || r.dot; e.up = e.up || r.up; e.dn = e.dn || r.dn; } else { e.rup = e.rup || r.up; e.rdn = e.rdn || r.dn; } } else evs.push({ x: r.x, qx: r.x, o: null, half: !!r.half, dot: !!r.dot, up: r.up, dn: r.dn }); });
      evs.sort((a, b) => a.x - b.x);
      const qs0 = omrQuantize(evs.map(e => e.qx), c, W, T, S, padL, m === 0 || !!zoneEndM, evs.map(e => e.o ? e.o.heads.some(q => q.dot) : !!e.dot), evs.map(e => e.o ? Math.max(0, ...e.o.heads.map(q => q.sd ? q.nb : 0)) : 0)), qs = [];
      evs.forEach((e, i) => {                                      // 2分休符(長さが96とわかっている)は、拍の頭に置き、次の音をその96あとに合わせる
        if (e.o || !e.half || qs0[i].tup) return; const t0 = qs0[i].t, t1 = Math.floor((t0 + 11) / 24) * 24, nx = qs0[i + 1];
        if (!nx || nx.tup || Math.abs(nx.t - (t1 + 96)) > 12 || (i > 0 && qs0[i - 1].t >= t1)) return;
        const dl = t1 + 96 - nx.t; qs0[i].t = t1; for (let k = i + 1; k < evs.length; k++) if (!qs0[k].tup && qs0[k].t + dl <= T - 6) qs0[k].t += dl;
      });
      evs.forEach((e, i) => { if (e.o) qs.push(qs0[i]); });
      const slots = [];
      onsets.forEach((o, i) => { const q = qs[i], l = slots[slots.length - 1], gr = (sy.graces || []).filter(g => o.heads.includes(g.main)).length;
        if (l && l.t === q.t) { l.heads.push(...o.heads); l.gr = Math.max(l.gr || 0, gr); } else slots.push({ t: q.t, tup: q.tup, heads: o.heads.slice(), gr }); });
      slots.forEach(sl => { const seen = new Set(); sl.heads = sl.heads.filter(h => !seen.has(h.inst) && seen.add(h.inst)); });
      const restsT = []; evs.forEach((e, i) => { if (!e.o) restsT.push({ t: qs0[i].t, up: !!e.up, dn: !!e.dn }); else if (e.rup || e.rdn) restsT.push({ t: qs0[i].t, up: !!e.rup, dn: !!e.rdn }); });
      measures.push({ sys: si, idx: measures.length, rs: !!sy.repStart[m], re: !!sy.repEnd[m + 1], x0: xl, x1: xr, c, slots, restsT, ev: evs.map((e, i) => Math.round(e.x) + (e.o ? "n" : "r") + (e.dot ? "." : "") + ":" + qs0[i].t + (qs0[i].tup ? "t" : "")), ts: tsCur, mark: markOf[m] || "", mrN: mr ? Math.max(1, mr.count) : 0, top: sy.st.lines[0], bottom: sy.st.lines[4] });
    }
  });
  return { ok: true, skew, gray: g, w, h, S, systems, measures, padL, bpm, tsFound };
}

/* ---- リハーサル記号(四角で囲んだ文字)と、テンポ(♩=数字) ---- */
function omrFindBoxes(bin, w, h, st) {
  const S = st.S, y0 = st.lines[0], out = [], runsAt = {};
  const ya = Math.max(0, Math.round(y0 - 10.5 * S)), yb = Math.max(0, Math.round(y0 - 0.8 * S));
  for (let y = ya; y <= yb; y++) {
    const rr = []; let x = Math.max(0, st.left);
    while (x <= st.right) { if (bin[y * w + x]) { let j = x; while (j + 1 <= st.right && bin[y * w + j + 1]) j++; const L = j - x + 1; if (L >= 1.0 * S && L <= 14 * S) rr.push([x, j]); x = j + 1; } else x++; }
    if (rr.length) runsAt[y] = rr;
  }
  Object.keys(runsAt).map(Number).sort((a, b) => a - b).forEach(y => {
    runsAt[y].forEach(([xa, xb]) => {
      if (out.some(o => Math.abs((o.xa + o.xb) / 2 - (xa + xb) / 2) < 0.6 * S && Math.abs(o.ya - y) < 3 * S && Math.abs(o.xb - o.xa - (xb - xa)) < 0.6 * S)) return;
      for (let d = Math.round(1.2 * S); d <= Math.round(3.9 * S); d++) {
        const rr = runsAt[y + d]; if (!rr) continue; if (!rr.find(([a, b]) => Math.abs(a - xa) <= 2 && Math.abs(b - xb) <= 2)) continue;
        let okL = 0, okR = 0; for (let yy = y; yy <= y + d; yy++) { if (bin[yy * w + xa] || bin[yy * w + xa + 1]) okL++; if (bin[yy * w + xb] || bin[yy * w + xb - 1]) okR++; }
        if (okL >= 0.85 * (d + 1) && okR >= 0.85 * (d + 1)) { out.push({ xa, xb, ya: y, yb: y + d }); return; }
      }
    });
  });
  return out;
}
function omrReadMark(bin, w, bx) {
  const m = Math.max(3, Math.round((bx.yb - bx.ya) * 0.12)), ink = (x, y) => bin[y * w + x] === 1;
  const v = omrVecOf(ink, bx.xa + m, bx.ya + m, bx.xb - m, bx.yb - m, 24, 16); if (!v) return "";
  const cands = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").concat(OMR_WORDS), r0 = omrMatch(v, cands, 24, 16);
  for (const d of "1234") for (const L of "ABCDEFGH") { cands.push(d + L, L + d); }                       // 1A, 2B, A1 のような番号つきの記号
  const r = bx.xb - bx.xa > 1.45 * (bx.yb - bx.ya) ? omrMatch(v, cands, 24, 16) : r0;
  return r.text && r.score >= 0.55 ? r.text : "";
}
function omrFindTempo(bin, w, st, boxes) {
  const S = st.S, y0 = st.lines[0], xa = Math.max(0, st.left), xb = Math.round(st.left + 0.55 * (st.right - st.left)), ya = Math.max(0, Math.round(y0 - 6.4 * S)), yb = Math.round(y0 - 1.0 * S);
  const inBox = (x, y) => boxes.some(b => x >= b.xa - 2 && x <= b.xb + 2 && y >= b.ya - 2 && y <= b.yb + 2);
  const rw = xb - xa + 1, rh = yb - ya + 1; if (rw < 10 || rh < 10) return null;
  const lab = new Int32Array(rw * rh), comps = []; const on = (x, y) => bin[(ya + y) * w + xa + x] && !inBox(xa + x, ya + y);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    if (!on(x, y) || lab[y * rw + x]) continue; const id = comps.length + 1, st2 = [[x, y]]; lab[y * rw + x] = id; let a = x, b = x, c = y, d = y;
    while (st2.length) { const [px, py] = st2.pop(); if (px < a) a = px; if (px > b) b = px; if (py < c) c = py; if (py > d) d = py; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = px + dx, ny = py + dy; if (nx < 0 || ny < 0 || nx >= rw || ny >= rh || lab[ny * rw + nx] || !on(nx, ny)) continue; lab[ny * rw + nx] = id; st2.push([nx, ny]); } }
    comps.push({ a: xa + a, b: xa + b, c: ya + c, d: ya + d, id });
  }
  const dig = comps.filter(c => { const bh = c.d - c.c + 1, bw = c.b - c.a + 1; return bh >= 0.75 * S && bh <= 2.3 * S && bw <= 1.7 * S; }).sort((p, q) => p.a - q.a);
  const ink = (x, y) => bin[y * w + x] === 1 && !inBox(x, y);
  const groups = []; dig.forEach(c => { const g = groups[groups.length - 1]; if (g && c.a - g[g.length - 1].b <= 0.7 * S && Math.abs(c.c - g[0].c) < 0.7 * S) g.push(c); else groups.push([c]); });
  for (const g of groups) {
    if (g.length < 2 || g.length > 3) continue;
    const eq = comps.filter(c => c.b < g[0].a && g[0].a - c.b <= 1.8 * S && (c.b - c.a + 1) >= 0.5 * S && (c.d - c.c + 1) <= 0.7 * S);
    if (!eq.length) continue;
    let text = "", ok = true; for (const c of g) { const r = omrReadDigits(ink, c.a, c.c, c.b, c.d, 1); if (!r || r.text.length !== 1 || r.score < 0.6) { ok = false; break; } text += r.text; }
    if (ok && +text >= 30 && +text <= 300) return +text;
  }
  return null;
}

/* 読み取り結果 → アプリの小節データ(配列)。長さ = 次の音符までの間隔(最大4分音符) */
function omrToMeasures(res, tsKey) {
  const out = [];
  res.measures.forEach(rm => {
    const tk = rm.ts || tsKey || "4/4", ts = tsInfo(tk), n = rm.mrN >= 2 ? rm.mrN : 1;
    const m = newMeasure(tk); m.mark = rm.mark || ""; m.rs = !!rm.rs; m.re = !!rm.re;
    ["up", "down"].forEach(voice => {
      const list = rm.slots.map(s => ({ t: s.t, tup: s.tup, gr: s.gr, insts: s.heads.map(q => q.inst).filter(i => INSTRUMENTS[i].voice === voice) })).filter(s => s.insts.length);
      list.forEach((s, i) => {
        const next = list[i + 1], nr = (rm.restsT || []).filter(r => r.t > s.t && (voice === "up" ? r.up : r.dn)).map(r => r.t), gap = Math.min(next ? next.t : ts.ticks, ...nr) - s.t;   // 次の音符か、同じ声部の次の休符まで
        let d = s.tup ? (fitDur(Math.min(gap, 32), true) || 8) : fitDur(Math.min(gap, 48), false);
        if (!d) d = 6;
        s.insts.forEach(inst => toggleNote(m, inst, s.t, d, s.tup));
        if (s.gr) { const nn = m[voice].find(x => x.t === s.t); if (nn) { if (s.gr >= 2) nn.dr = true; else nn.fl = true; } }      // 装飾音(フラム/ドラッグ)
      });
    });
    out.push(m);
    if (rm.mrN >= 1) m.mr = true;
    if (n >= 2) { for (let k = 1; k < n; k++) out.push(newMeasure(tk)); }              // N小節休符 → 空の小節をN個(まとめて表示)
  });
  return out;
}
function omrCount(res) { let n = 0; res.measures.forEach(m => m.slots.forEach(s => { n += s.heads.length; })); return n; }

if (typeof module !== "undefined") {
  module.exports = Object.assign(module.exports || {}, { omrGray, omrBinarize, omrSkew, omrRotate, omrFindStaves, omrRecognize, omrToMeasures, omrCount });
}
