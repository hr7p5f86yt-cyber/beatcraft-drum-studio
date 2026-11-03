/* ===== render.js : 楽譜レイアウト計算 + SVG生成 =====
 * 流れ: スコア(データ) → layoutScore(座標・段組み) → SVG文字列
 * 寸法はすべて LAYOUT にまとめる。見た目の調整は LAYOUT の値だけで行う。
 * 座標系: SVGのviewBox。1スペース(五線の線間隔) S = 9。 */
const LAYOUT = {
  S: 9, PAGE_W: 1100, MARGIN: 40,
  TOP_PAD: 74, BOTTOM_PAD: 58, ROW_GAP: 14, TITLE_H: 100,
  STEM_LEN: 31, BEAM_TH: 4.2, BEAM_GAP: 6.8, STEM_W: 1.3, LINE_W: 1,
  OVAL_RX: 5.4, OVAL_RY: 3.9, CROSS: 4.4,
  CLEF_W: 24, TS_W: 28, PAD_L: 12, PAD_R: 10, HEAD_OFF: 6,
  MIN_GAP_PX: 13, PPT_MIN: 1.05, PPT_MAX: 2.2,
  RS_PAD: 12, RE_PAD: 9, DYN_DY: 48, HP_DY: 43
};
const f = n => Math.round(n * 10) / 10;

/* ---- 1) レイアウト: 段組みと各小節のx座標 ---- */
function layoutScore(score) {
  const L = LAYOUT, rowW = L.PAGE_W - 2 * L.MARGIN;
  const starts = measureStarts(score);
  const items = score.measures.map((m, idx) => {
    const info = tsInfo(m.ts);
    const onsets = new Set();
    for (const v of ["up", "down"]) for (const n of m[v]) onsets.add(n.t);
    const arr = [...onsets].sort((a, b) => a - b); let minD = 48;
    for (let k = 1; k < arr.length; k++) minD = Math.min(minD, arr[k] - arr[k - 1]);
    const ppt = Math.min(L.PPT_MAX, Math.max(L.PPT_MIN, L.MIN_GAP_PX / minD));
    return { idx, m, ticks: info.ticks, beat: info.beat, ppt, tw: info.ticks * ppt };
  });
  for (let i = 0; i < items.length; i++) {                         // 複数小節休符: 先頭だけ描き、残りは幅0で隠す
    const n = multiRestRun(score, i); if (!n) continue;
    items[i].mrN = n; for (let j = i + 1; j < i + n; j++) { items[j].hidden = true; items[j].tw = 0; }
    i += n - 1;
  }
  const rows = []; let row = [], sum = 0;
  items.forEach(it => {
    if (it.hidden) { row.push(it); return; }
    const showTs = it.idx === 0 || score.measures[it.idx - 1].ts !== it.m.ts;
    it.showTs = showTs;
    const first = row.length === 0;
    const pre = (first ? L.CLEF_W : 0) + (showTs ? L.TS_W : 0) + L.PAD_L + (it.m.rs ? L.RS_PAD : 0);
    const w = pre + it.tw + L.PAD_R + (it.m.re ? L.RE_PAD : 0);
    if (!first && sum + w > rowW) { rows.push(row); row = []; sum = 0; }
    row.push(it); sum += w;
  });
  if (row.length) rows.push(row);
  let y = L.TITLE_H;
  const measures = [];
  rows.forEach((r, ri) => {
    r.forEach((it, k) => {
      if (it.hidden) { it.pre = 0; it.fixed = 0; return; }
      it.first = k === 0;
      it.pre = (it.first ? L.CLEF_W : 0) + (it.showTs ? L.TS_W : 0) + L.PAD_L + (it.m.rs ? L.RS_PAD : 0);
      it.fixed = it.pre + L.PAD_R + (it.m.re ? L.RE_PAD : 0);
    });
    const fixed = r.reduce((a, it) => a + it.fixed, 0), tws = r.reduce((a, it) => a + it.tw, 0);
    const extra = rowW - fixed - tws;
    const last = ri === rows.length - 1;
    const grow = Math.max(0, last ? Math.min(extra, tws * 0.6) : extra) / tws;
    let x = L.MARGIN;
    r.forEach(it => {
      if (it.hidden) { it.ppt = 0; it.tw = 0; }
      else { it.ppt *= (1 + grow); it.tw = it.ticks * it.ppt; }
      it.x0 = x; it.w = it.fixed + it.tw; it.staffTop = y + L.TOP_PAD;
      it.sysTop = y; it.sysBottom = y + L.TOP_PAD + 4 * L.S + L.BOTTOM_PAD;
      it.xStart = it.x0 + it.pre; it.gStart = starts[it.idx];
      x += it.w; measures.push(it);
    });
    y += L.TOP_PAD + 4 * L.S + L.BOTTOM_PAD + L.ROW_GAP;
  });
  return { measures, height: y + 20, width: L.PAGE_W };
}

/* ---- 2) 部品: 符頭・休符・旗 ---- */
function headSvg(cx, cy, inst, info) {
  const L = LAYOUT; let s = "";
  if (inst.head === "cross") {
    const r = inst.name === "Crash" ? L.CROSS + 0.8 : L.CROSS;
    s += `<path d="M${f(cx - r)} ${f(cy - r)}L${f(cx + r)} ${f(cy + r)}M${f(cx - r)} ${f(cy + r)}L${f(cx + r)} ${f(cy - r)}" stroke="#000" stroke-width="1.6" fill="none"/>`;
    if (inst.open) s += `<circle cx="${f(cx)}" cy="${f(cy - 9)}" r="2.7" fill="none" stroke="#000" stroke-width="1.1"/>`;
  } else {
    const hollow = info.nv >= 96, whole = info.nv >= 192;
    s += `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${whole ? L.OVAL_RX + 1 : L.OVAL_RX}" ry="${L.OVAL_RY}" transform="rotate(-20 ${f(cx)} ${f(cy)})" fill="${hollow ? "#fff" : "#000"}" stroke="#000" stroke-width="${hollow ? 1.5 : 0.5}"/>`;
  }
  return s;
}
function headHalfWidth(inst) { return inst.head === "cross" ? LAYOUT.CROSS : LAYOUT.OVAL_RX; }

function flagSvg(x, y, dirUp, count) {
  let s = "";
  for (let k = 0; k < count; k++) {
    const o = k * 6.5 * (dirUp ? 1 : -1), sg = dirUp ? 1 : -1;
    s += `<path d="M${f(x)} ${f(y + o)}Q${f(x + 9)} ${f(y + o + 6 * sg)} ${f(x + 6)} ${f(y + o + 17 * sg)}Q${f(x + 7)} ${f(y + o + 9 * sg)} ${f(x)} ${f(y + o + 8 * sg)}Z" fill="#000"/>`;
  }
  return s;
}

function restSvg(x, staffTop, voice, e) {
  const S = LAYOUT.S, info = durInfo(e.d, e.tup), up = voice === "up";
  const yc = staffTop + (up ? 1.4 : 2.9) * S; let s = "";
  const k = (a, b) => `<path d="${a}" stroke="#000" stroke-width="${b}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (info.nv >= 192) {
    const y = staffTop + (up ? 1 : 3) * S; s += `<rect x="${f(x - 6)}" y="${f(y)}" width="12" height="4.5" fill="#000"/>`;
  } else if (info.nv >= 96) {
    const y = staffTop + (up ? 2 : 4) * S; s += `<rect x="${f(x - 6)}" y="${f(y - 4.5)}" width="12" height="4.5" fill="#000"/>`;
  } else if (info.nv >= 48) {
    s += k(`M${f(x - 2)} ${f(yc - 11)}L${f(x + 2.5)} ${f(yc - 4.5)}L${f(x - 2)} ${f(yc + 1)}L${f(x + 2.5)} ${f(yc + 7)}Q${f(x - 4)} ${f(yc + 6)} ${f(x - 2.5)} ${f(yc + 11)}`, 2.3);
  } else {
    const n = info.nv >= 24 ? 1 : info.nv >= 12 ? 2 : 3;
    s += k(`M${f(x + 3.5)} ${f(yc - 7)}L${f(x - 2 - (n - 1) * 1.2)} ${f(yc + 9 + (n - 1) * 5)}`, 1.5);
    for (let j = 0; j < n; j++) {
      const dy = yc - 5 + j * 6.2, dx = x - 0.5 - j * 1.3;
      s += `<circle cx="${f(dx - 1.2)}" cy="${f(dy)}" r="2.1" fill="#000"/>` + k(`M${f(dx - 1.2)} ${f(dy)}Q${f(dx + 2)} ${f(dy - 0.5)} ${f(dx + 4.5)} ${f(dy - 2.5)}`, 1.4);
    }
  }
  if (info.dots) s += `<circle cx="${f(x + 8)}" cy="${f(yc - 3)}" r="1.5" fill="#000"/>`;
  return s;
}

/* ---- 3) 1小節の音符・休符・連桁 ---- */
function measureNotesSvg(it, out) {
  const L = LAYOUT, S = L.S, m = it.m; let s = "";
  const xOf = t => it.xStart + L.HEAD_OFF + t * it.ppt;
  const bothEmpty = m.up.length === 0 && m.down.length === 0;
  if (!it.mrN && m.mr && bothEmpty && !m.sim && !m.rs && !m.re)               // 1小節だけの休み: 休符の上に「1」
    s += `<text x="${f(it.xStart + it.tw * 0.62)}" y="${f(it.staffTop - 10)}" font-family="'Times New Roman','Noto Serif JP',serif" font-weight="bold" font-size="21" text-anchor="middle">1</text>`;
  if (it.mrN) {                                                  // 複数小節休符: 太い横線 + 小節数
    const x1 = it.xStart + 6, x2 = it.xStart + it.tw - 2, y = it.staffTop + 2 * S, serif = "'Times New Roman','Noto Serif JP',serif";
    return `<rect x="${f(x1)}" y="${f(y - 2.6)}" width="${f(x2 - x1)}" height="5.2" fill="#000"/><line x1="${f(x1)}" y1="${f(y - 8)}" x2="${f(x1)}" y2="${f(y + 8)}" stroke="#000" stroke-width="1.4"/><line x1="${f(x2)}" y1="${f(y - 8)}" x2="${f(x2)}" y2="${f(y + 8)}" stroke="#000" stroke-width="1.4"/>`
      + `<text x="${f((x1 + x2) / 2)}" y="${f(it.staffTop - 10)}" font-family="${serif}" font-weight="bold" font-size="21" text-anchor="middle">${it.mrN}</text>`;
  }
  if (m.sim && it.idx > 0) {                                     // 小節繰り返し(%)
    const cx = it.xStart + it.tw / 2, cy = it.staffTop + 2 * S, w = 13, h = 10;
    return `<polygon points="${f(cx - w)},${f(cy + h)} ${f(cx - w + 8)},${f(cy + h)} ${f(cx + w)},${f(cy - h)} ${f(cx + w - 8)},${f(cy - h)}" fill="#000"/>`
      + `<circle cx="${f(cx - w + 1)}" cy="${f(cy - h + 3)}" r="2.7" fill="#000"/><circle cx="${f(cx + w - 1)}" cy="${f(cy + h - 3)}" r="2.7" fill="#000"/>`;
  }
  if (bothEmpty) {
    const cx = it.xStart + it.tw / 2, y = it.staffTop + S;
    return s + `<rect x="${f(cx - 6)}" y="${f(y)}" width="12" height="4.5" fill="#000"/>`;
  }
  for (const voice of ["up", "down"]) {
    if (m[voice].length === 0) continue;                       // 空の声部は休符を出さない
    const dirUp = voice === "up", ev = fillRests(m[voice], it.ticks, it.beat);
    const stemX = e => xOf(e.t) + (dirUp ? 1 : -1) * (e.hw - 0.6);
    // 各音符の頭の位置と符幹の端(先に計算)
    for (const e of ev) {
      if (e.rest) continue;
      const ys = e.i.map(k => it.staffTop + INSTRUMENTS[k].h * S / 2);
      e.top = Math.min(...ys); e.bot = Math.max(...ys);
      e.hw = Math.max(...e.i.map(k => headHalfWidth(INSTRUMENTS[k])));
      e.info = durInfo(e.d, e.tup);
      e.end = dirUp ? e.top - L.STEM_LEN : e.bot + L.STEM_LEN;
    }
    const groups = beamGroups(ev, it.beat, it.ticks), inBeam = new Set();
    groups.forEach(g => {
      const end = dirUp ? Math.min(...g.map(e => e.end)) : Math.max(...g.map(e => e.end));
      g.forEach(e => { e.end = end; inBeam.add(e); });
    });
    for (const e of ev) {
      const x = xOf(e.t);
      if (e.rest) { s += restSvg(x, it.staffTop, voice, e); continue; }
      e.i.forEach(k => {                                       // 補助線(クラッシュなど五線の上の音)
        const h = INSTRUMENTS[k].h;
        if (h <= -2 && h % 2 === 0) for (let q = -2; q >= h; q -= 2) {
          const yy = it.staffTop + q * S / 2;
          s += `<line x1="${f(x - 8)}" y1="${f(yy)}" x2="${f(x + 8)}" y2="${f(yy)}" stroke="#000" stroke-width="1.1"/>`;
        }
      });
      if (e.info.nv < 192) {                                    // 符幹
        const sx = stemX(e), y0 = dirUp ? e.bot : e.top;
        s += `<line x1="${f(sx)}" y1="${f(y0)}" x2="${f(sx)}" y2="${f(e.end)}" stroke="#000" stroke-width="${L.STEM_W}"/>`;
        if (e.info.flags > 0 && !inBeam.has(e)) s += flagSvg(sx, e.end, dirUp, e.info.flags);
      }
      e.i.forEach(k => {
        const inst = INSTRUMENTS[k], cy = it.staffTop + inst.h * S / 2;
        s += headSvg(x, cy, inst, e.info);
        out.heads.push({ m: it.idx, voice, t: e.t, inst: k, x, y: cy });
        if (e.info.dots) s += `<circle cx="${f(x + e.hw + (e.gh ? 12 : 5))}" cy="${f(inst.h % 2 === 0 ? cy - S / 2 : cy)}" r="1.5" fill="#000"/>`;
      });
      if (e.fl || e.dr) {                                       // 装飾音(フラム/ドラッグ): 小さな音符を本体の左に(斜線つき)
        const k0 = e.i.filter(k => INSTRUMENTS[k].voice === voice && INSTRUMENTS[k].head !== "cross")[0] || e.i[0], hh = INSTRUMENTS[k0].h, gy = it.staffTop + hh * S / 2, n = e.dr ? 2 : 1;
        for (let j = 0; j < n; j++) {
          const gx = x - e.hw - 9 - (n - 1 - j) * 8, gsx = gx + (dirUp ? 3.4 : -3.4), ge = dirUp ? gy - 17 : gy + 17;
          s += `<ellipse cx="${f(gx)}" cy="${f(gy)}" rx="3.6" ry="2.6" transform="rotate(-20 ${f(gx)} ${f(gy)})" fill="#000"/>`
            + `<line x1="${f(gsx)}" y1="${f(gy)}" x2="${f(gsx)}" y2="${f(ge)}" stroke="#000" stroke-width="1"/>`
            + `<path d="M${f(gsx - 3)} ${f(dirUp ? ge + 6 : ge - 6)}L${f(gsx + 4)} ${f(dirUp ? ge - 1 : ge + 1)}" stroke="#000" stroke-width="1"/>`;
        }
      }
      if (e.gh) {                                               // ゴースト: 音符全体を括弧で囲む
        const lx = x - e.hw - 3.5, rx = x + e.hw + 3.5, y0 = e.top - 6, y1 = e.bot + 6, ym = (y0 + y1) / 2;
        s += `<path d="M${f(lx)} ${f(y0)}Q${f(lx - 5)} ${f(ym)} ${f(lx)} ${f(y1)}M${f(rx)} ${f(y0)}Q${f(rx + 5)} ${f(ym)} ${f(rx)} ${f(y1)}" stroke="#000" stroke-width="1.2" fill="none"/>`;
      }
      if (e.acc) {                                              // アクセント >
        const ay = dirUp ? e.end - 8 : e.end + 8, ax = stemX(e);
        s += `<path d="M${f(ax - 5.5)} ${f(ay - 3.6)}L${f(ax + 5)} ${f(ay)}L${f(ax - 5.5)} ${f(ay + 3.6)}" stroke="#000" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
    }
    groups.forEach(g => {                                       // 連桁(1〜3本)
      for (let lv = 1; lv <= 3; lv++) {
        let k = 0;
        while (k < g.length) {
          if (durInfo(g[k].d, g[k].tup).flags < lv) { k++; continue; }
          let j = k; while (j + 1 < g.length && durInfo(g[j + 1].d, g[j + 1].tup).flags >= lv) j++;
          let x1 = stemX(g[k]) - L.STEM_W / 2, x2 = stemX(g[j]) + L.STEM_W / 2;
          if (j === k) { if (k === 0) x2 = x1 + 7; else x1 = x2 - 7; }   // 短い連桁(旗の代わり)
          const yb = dirUp ? g[0].end + (lv - 1) * L.BEAM_GAP : g[0].end - (lv - 1) * L.BEAM_GAP - L.BEAM_TH;
          s += `<rect x="${f(x1)}" y="${f(yb)}" width="${f(x2 - x1)}" height="${L.BEAM_TH}" fill="#000"/>`;
          k = j + 1;
        }
      }
    });
    tupletGroups(ev).forEach(g => {                             // 3連符の数字「3」
      const notes = g.filter(e => !e.rest); if (!notes.length) return;
      const cx = (xOf(g[0].t) + xOf(g[g.length - 1].t)) / 2;
      const pad = notes.some(e => e.acc) ? 12 : 0;
      const y = dirUp ? Math.min(...notes.map(e => e.end)) - 6 - pad : Math.max(...notes.map(e => e.end)) + 15 + pad;
      s += `<text x="${f(cx)}" y="${f(y)}" font-family="'Times New Roman',serif" font-style="italic" font-weight="bold" font-size="13" text-anchor="middle">3</text>`;
    });
  }
  return s;
}

/* ---- 3b) 強弱記号・クレッシェンド(五線の下) ---- */
function marksSvg(it, hairpins, dynAt) {
  const L = LAYOUT, S = L.S, top = it.staffTop, m = it.m; let s = "";
  const xOf = t => it.xStart + L.HEAD_OFF + t * it.ppt;
  const serif = "'Times New Roman','Noto Serif JP',serif";
  (m.dyn || []).forEach(d => {
    s += `<text x="${f(xOf(d.t))}" y="${f(top + 4 * S + L.DYN_DY)}" font-family="${serif}" font-style="italic" font-weight="bold" font-size="17" text-anchor="middle">${d.v}</text>`;
  });
  hairpins.forEach(h => {
    const a = Math.max(h.gs, it.gStart), b = Math.min(h.ge, it.gStart + it.ticks);
    if (b <= a) return;
    const H = 5.2, hAt = g => (h.k === "c" ? H * (g - h.gs) / (h.ge - h.gs) : H * (1 - (g - h.gs) / (h.ge - h.gs)));
    let x1 = xOf(a - it.gStart), x2 = xOf(b - it.gStart);
    if (a === h.gs && dynAt[h.gs]) x1 += dynAt[h.gs].length * 5.4 + 5;          // 同じ位置の強弱記号の右から始める
    if (b === h.ge && dynAt[h.ge] && h.ge < it.gStart + it.ticks) x2 -= dynAt[h.ge].length * 5.4 + 5;   // 次の強弱記号の手前で止める
    if (x2 - x1 < 8) x2 = x1 + 8;
    const y = top + 4 * S + L.HP_DY, h1 = hAt(a), h2 = hAt(b);
    s += `<path d="M${f(x1)} ${f(y - h1)}L${f(x2)} ${f(y - h2)}M${f(x1)} ${f(y + h1)}L${f(x2)} ${f(y + h2)}" stroke="#000" stroke-width="1.3" fill="none"/>`;
  });
  return s;
}
function repeatBarsSvg(it) {
  const S = LAYOUT.S, top = it.staffTop; let s = "";
  const dots = x => `<circle cx="${f(x)}" cy="${f(top + 1.5 * S)}" r="1.8" fill="#000"/><circle cx="${f(x)}" cy="${f(top + 2.5 * S)}" r="1.8" fill="#000"/>`;
  if (it.m.rs) s += `<rect x="${f(it.x0 - 0.6)}" y="${top}" width="3.4" height="${4 * S}" fill="#000"/><line x1="${f(it.x0 + 6)}" y1="${top}" x2="${f(it.x0 + 6)}" y2="${top + 4 * S}" stroke="#000" stroke-width="1.2"/>` + dots(it.x0 + 11);
  if (it.m.re) { const xr = it.x0 + it.w; s += `<rect x="${f(xr - 3)}" y="${top}" width="3.4" height="${4 * S}" fill="#000"/><line x1="${f(xr - 8)}" y1="${top}" x2="${f(xr - 8)}" y2="${top + 4 * S}" stroke="#000" stroke-width="1.2"/>` + dots(xr - 13); }
  return s;
}

/* ---- 4) 全体のSVG ---- */
/* 「%(前と同じ)」を音符で表示する設定のとき、描画用に %小節を元の小節の中身で置き換えたコピーを作る(データは変えない) */
function displayScore(score) {
  if (!score.simNotes || !score.measures.some(m => m.sim)) return score;
  const cp = o => JSON.parse(JSON.stringify(o));
  return Object.assign({}, score, { measures: score.measures.map((m, i) => {
    if (!m.sim || i === 0) return m;
    const src = simSource(score, i), ticks = tsInfo(m.ts).ticks;
    return Object.assign({}, m, { sim: false, up: cp(src.up).filter(n => n.t < ticks), down: cp(src.down).filter(n => n.t < ticks) });
  }) });
}
function buildScoreSvg(score, opt) {
  opt = opt || {}; score = displayScore(score);
  const L = LAYOUT, S = L.S, lay = layoutScore(score);
  const out = { heads: [], layout: lay };
  let s = `<rect x="0" y="0" width="${lay.width}" height="${lay.height}" fill="#fff"/>`;
  const serif = "'Times New Roman','Noto Serif JP','Hiragino Mincho ProN',serif";
  s += `<text x="${lay.width / 2}" y="46" font-family="${serif}" font-size="28" text-anchor="middle">${escapeHtml(score.title)}</text>`;
  s += `<text x="${L.MARGIN}" y="34" font-family="${serif}" font-size="15">Drum Kit</text>`;
  if (score.subtitle) s += `<text x="${lay.width / 2}" y="78" font-family="${serif}" font-size="22" text-anchor="middle">${escapeHtml(score.subtitle)}</text>`;
  if (score.composer) s += `<text x="${lay.width - L.MARGIN}" y="68" font-family="${serif}" font-size="14" text-anchor="end">${escapeHtml(score.composer)}</text>`;
  let lastIdx = lay.measures.length - 1; while (lastIdx > 0 && lay.measures[lastIdx].hidden) lastIdx--;
  const hairpins = [], dynAt = {};                                  // 強弱記号は小節をまたぐので、全体tickで集めておく
  lay.measures.forEach(it => {
    (it.m.hp || []).forEach(h => hairpins.push({ gs: it.gStart + h.t, ge: it.gStart + h.t + h.len, k: h.k }));
    (it.m.dyn || []).forEach(d => { dynAt[it.gStart + d.t] = d.v; });
  });
  lay.measures.forEach(it => {
    if (it.hidden) return;
    const top = it.staffTop;
    for (let l = 0; l < 5; l++) s += `<line x1="${f(it.x0)}" y1="${top + l * S}" x2="${f(it.x0 + it.w)}" y2="${top + l * S}" stroke="#000" stroke-width="${L.LINE_W}"/>`;
    s += `<line x1="${f(it.x0)}" y1="${top}" x2="${f(it.x0)}" y2="${top + 4 * S}" stroke="#000" stroke-width="1.2"/>`;
    const prevM = it.idx > 0 ? score.measures[it.idx - 1] : null;
    if (!it.first && prevM && (it.m.mark || prevM.dbl)) s += `<line x1="${f(it.x0 - 4)}" y1="${top}" x2="${f(it.x0 - 4)}" y2="${top + 4 * S}" stroke="#000" stroke-width="1.2"/>`;   // 二重線(リハーサル記号の前、または dbl)
    const fin = it.idx === lastIdx;
    s += `<line x1="${f(it.x0 + it.w)}" y1="${top}" x2="${f(it.x0 + it.w)}" y2="${top + 4 * S}" stroke="#000" stroke-width="${fin ? 3 : 1.2}"/>`;
    if (fin) s += `<line x1="${f(it.x0 + it.w - 5)}" y1="${top}" x2="${f(it.x0 + it.w - 5)}" y2="${top + 4 * S}" stroke="#000" stroke-width="1.2"/>`;
    const rp = it.m.rs ? L.RS_PAD : 0;
    let cx = it.x0 + 6 + rp;
    if (it.first) {                                            // 打楽器記号(縦2本線)
      s += `<rect x="${f(cx + 2)}" y="${top + S}" width="3.6" height="${2 * S}" fill="#000"/><rect x="${f(cx + 9)}" y="${top + S}" width="3.6" height="${2 * S}" fill="#000"/>`;
      cx = it.x0 + L.CLEF_W + rp;
    }
    if (it.showTs) {
      const info = tsInfo(it.m.ts), tx = cx + L.TS_W / 2 - 2;
      s += `<text x="${f(tx)}" y="${top + 17.5}" font-family="${serif}" font-weight="bold" font-size="25" text-anchor="middle">${info.top}</text>`
         + `<text x="${f(tx)}" y="${top + 35.5}" font-family="${serif}" font-weight="bold" font-size="25" text-anchor="middle">${info.bottom}</text>`;
    }
    if (it.m.mark) s += `<rect x="${f(it.x0 + 4)}" y="${top - 66}" width="${12 + it.m.mark.length * 11}" height="19" fill="#fff" stroke="#000" stroke-width="1.5"/>`
      + `<text x="${f(it.x0 + 10 + it.m.mark.length * 5.5)}" y="${top - 51}" font-family="${serif}" font-weight="bold" font-size="15" text-anchor="middle">${escapeHtml(it.m.mark)}</text>`;
    s += repeatBarsSvg(it) + measureNotesSvg(it, out) + marksSvg(it, hairpins, dynAt);
    // テンポ記号は最初の小節の上(リハーサル記号があればその右)
    if (it.idx === 0) {
      const tx = it.x0 + 8 + (it.m.mark ? 12 + it.m.mark.length * 11 + 10 : 0), ty = top - 51;
      s += `<ellipse cx="${f(tx + 4)}" cy="${ty - 1}" rx="4.6" ry="3.4" transform="rotate(-20 ${f(tx + 4)} ${ty - 1})" fill="#000"/><line x1="${f(tx + 8.3)}" y1="${ty - 2}" x2="${f(tx + 8.3)}" y2="${ty - 20}" stroke="#000" stroke-width="1.3"/>`
         + `<text x="${f(tx + 15)}" y="${ty}" font-family="${serif}" font-weight="bold" font-size="15">= ${score.bpm}</text>`;
    }
    // 小節番号は、段の一番左の小節だけに表示する(最初の段の1小節目は省略)。タップで設定を開く当たり判定は全小節にある
    s += `<rect data-measure="${it.idx}" x="${f(it.x0 + 1)}" y="${top - 22}" width="26" height="17" fill="#fff" fill-opacity="0" style="cursor:pointer"/>`;
    if (it.first && it.idx > 0) s += `<text data-measure="${it.idx}" x="${f(it.x0 + 3)}" y="${top - 10}" font-family="${serif}" font-style="italic" font-size="13" fill="#000" style="cursor:pointer">${it.idx + 1}</text>`;
  });
  return { svg: s, width: lay.width, height: lay.height, layout: lay, heads: out.heads };
}

function scoreToSvgDocument(score) {
  const r = buildScoreSvg(score);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${r.width}" height="${r.height}" viewBox="0 0 ${r.width} ${r.height}">${r.svg}</svg>`;
}
if (typeof module !== "undefined") {
  Object.assign(module.exports = module.exports || {}, { LAYOUT, layoutScore, buildScoreSvg, scoreToSvgDocument });
}
