/* ===== model.js : データモデル・音価・休符・連桁・保存データ移行 =====
 * 時間の単位: 1拍(4分音符) = 48 tick。4/4 = 192tick。
 *   16分=12, 32分=6, 8分3連=16, 16分3連=8, 4分3連=32 を整数で表せる。
 * 小節: { ts:"4/4", mark:"", up:[音符...], down:[音符...] }
 *   up   = 手(クラッシュ/ハイハット/ライド/タム/スネア) 符幹は上向き
 *   down = 足(キック) 符幹は下向き
 * 音符: { t:開始tick, d:長さtick, tup:3連符か, i:[楽器キー...], acc?:アクセント, gh?:ゴースト(括弧付き), bm?:"break"|"join" }
 *   bm = 連桁の手動指定。"break"=直前の音符とのつながりを切る / "join"=拍をまたいで直前とつなぐ
 *   休符は保存せず自動で補う
 * 小節の記号: dyn:[{t,v}] 強弱記号 / hp:[{t,len,k}] 強弱の変化(k:"c"=クレッシェンド "d"=デクレッシェンド, len=tick数で次の小節にまたがってよい)
 *             rs / re : 繰り返しの開始 / 終了 (true のとき)
 *             sim: 直前の小節と同じ(%) / mr: ここから続く空の小節を1つにまとめて表示 / dbl: 小節の終わりに二重線
 */
const TPQ = 48;
const SCHEMA_VERSION = 4;
/* 強弱記号 → 演奏の強さ(MIDIベロシティ 0〜127)。記号が無い所は mf */
const DYN_LEVELS = { ppp: 24, pp: 38, p: 52, mp: 66, mf: 80, f: 96, ff: 112, fff: 124 };
const DYN_ORDER = ["ppp", "pp", "p", "mp", "mf", "f", "ff", "fff"];
const DEFAULT_LEVEL = 80, ACCENT_BOOST = 26, GHOST_RATIO = 0.45, HAIRPIN_SPAN = 28;
const TIME_SIGS = {
  "4/4": { ticks: 192, beat: 48, top: 4, bottom: 4 },
  "3/4": { ticks: 144, beat: 48, top: 3, bottom: 4 },
  "2/4": { ticks: 96,  beat: 48, top: 2, bottom: 4 },
  "6/8": { ticks: 144, beat: 72, top: 6, bottom: 8 },
  "5/4": { ticks: 240, beat: 48, top: 5, bottom: 4 },
  "6/4": { ticks: 288, beat: 48, top: 6, bottom: 4 },
  "7/4": { ticks: 336, beat: 48, top: 7, bottom: 4 },
  "2/2": { ticks: 192, beat: 96, top: 2, bottom: 2 },
  "3/8": { ticks: 72,  beat: 72, top: 3, bottom: 8 },
  "5/8": { ticks: 120, beat: 48, top: 5, bottom: 8 },
  "7/8": { ticks: 168, beat: 48, top: 7, bottom: 8 },
  "9/8": { ticks: 216, beat: 72, top: 9, bottom: 8 },
  "12/8": { ticks: 288, beat: 72, top: 12, bottom: 8 }
};
/* 拍子を変える。はみ出す音符は切り詰める(戻り値: 変更前より短くなった音符数) */
function setMeasureTs(m, ts) {
  const ticks = tsInfo(ts).ticks; let cut = 0; m.ts = ts;
  m.dyn = (m.dyn || []).filter(d => d.t < ticks); m.hp = (m.hp || []).filter(h => h.t < ticks);
  ["up", "down"].forEach(v => { m[v] = m[v].filter(n => n.t < ticks); m[v].forEach(n => { if (n.t + n.d > ticks) { n.d = fitDur(ticks - n.t, n.tup) || 6; cut++; } }); });
  return cut;
}

/* h = 五線上の位置(半スペース単位)。0=最上線, 2=2線, 4=中線, 6=4線, 8=最下線。負は五線の上 */
const INSTRUMENTS = {
  crash:    { name: "Crash",    h: -2, head: "cross",  voice: "up",   color: "#f59e0b" },
  hh_close: { name: "HH Close", h: -1, head: "cross",  voice: "up",   color: "#3b82f6" },
  hh_open:  { name: "HH Open",  h: -1, head: "cross",  voice: "up",   color: "#06b6d4", open: true },
  ride:     { name: "Ride",     h: 0,  head: "cross",  voice: "up",   color: "#8b5cf6" },
  hi_tom:   { name: "Hi-Tom",   h: 1,  head: "oval",   voice: "up",   color: "#ec4899" },
  snare:    { name: "Snare",    h: 3,  head: "oval",   voice: "up",   color: "#10b981" },
  low_tom:  { name: "Low-Tom",  h: 5,  head: "oval",   voice: "up",   color: "#f97316" },
  kick:     { name: "Kick",     h: 7,  head: "oval",   voice: "down", color: "#ef4444" }
};

/* 音価の表: key = "d" または "d:t"(3連符)。nv=記譜上の音価, dots=付点数, flags=旗の本数 */
const DUR_INFO = {
  "192":  { nv: 192, dots: 0, flags: 0 }, "144": { nv: 96, dots: 1, flags: 0 },
  "96":   { nv: 96,  dots: 0, flags: 0 }, "72":  { nv: 48, dots: 1, flags: 0 },
  "48":   { nv: 48,  dots: 0, flags: 0 }, "36":  { nv: 24, dots: 1, flags: 1 },
  "24":   { nv: 24,  dots: 0, flags: 1 }, "18":  { nv: 12, dots: 1, flags: 2 },
  "12":   { nv: 12,  dots: 0, flags: 2 }, "6":   { nv: 6,  dots: 0, flags: 3 },
  "32:t": { nv: 48,  dots: 0, flags: 0 }, "16:t": { nv: 24, dots: 0, flags: 1 },
  "8:t":  { nv: 12,  dots: 0, flags: 2 }
};
const NORMAL_DURS = [192, 144, 96, 72, 48, 36, 24, 18, 12, 6];

function durKey(d, tup) { return tup ? d + ":t" : String(d); }
function isValidDur(d, tup) { return !!DUR_INFO[durKey(d, tup)]; }
function durInfo(d, tup) { return DUR_INFO[durKey(d, tup)] || { nv: 12, dots: 0, flags: 2 }; }

/* gap以下で最大の有効な音価(同じ種類)を返す。なければ 0 */
function fitDur(gap, tup) {
  const list = tup ? [32, 16, 8] : NORMAL_DURS;
  for (const d of list) if (d <= gap) return d;
  return 0;
}

function tsInfo(ts) { return TIME_SIGS[ts] || TIME_SIGS["4/4"]; }
function newMeasure(ts) { return { ts: ts || "4/4", mark: "", up: [], down: [], dyn: [], hp: [], rs: false, re: false, sim: false, mr: false, dbl: false }; }
function newScore() {
  return { schemaVersion: SCHEMA_VERSION, title: "マイ・ドラム・スコア", subtitle: "", composer: "", simNotes: false, bpm: 120,
           measures: [newMeasure(), newMeasure(), newMeasure(), newMeasure()] };
}
function measureStarts(score) {
  const out = []; let acc = 0;
  for (const m of score.measures) { out.push(acc); acc += tsInfo(m.ts).ticks; }
  out.total = acc; return out;
}

/* ---- 音符の追加・削除 ---- */
/* 戻り値: "added" | "removed" | "invalid" */
function toggleNote(measure, instKey, t, d, tup, voice) {   // voice: "up"(1声)/"down"(2声)。省略すると楽器ごとの標準
  const inst = INSTRUMENTS[instKey];
  if (!inst) return "invalid";
  const info = tsInfo(measure.ts);
  const arr = measure[voice === "up" || voice === "down" ? voice : inst.voice];
  if (t < 0 || t >= info.ticks) return "invalid";
  const same = arr.find(n => n.t === t);
  if (same && same.i.includes(instKey)) {          // 同じ楽器をもう一度 → 削除
    same.i = same.i.filter(k => k !== instKey);
    if (same.i.length === 0) arr.splice(arr.indexOf(same), 1);
    return "removed";
  }
  let dd = d;
  if (t + dd > info.ticks) dd = fitDur(info.ticks - t, tup);   // 小節からはみ出す → 収まる最大の長さに
  if (!dd || !isValidDur(dd, tup)) return "invalid";
  if (same) {                                       // 同じ位置に和音として追加。長さは既存の音符のまま(他の音符を壊さない)
    same.i.push(instKey);
    same.i.sort((a, b) => INSTRUMENTS[a].h - INSTRUMENTS[b].h);
    return "added";
  } else {
    arr.push({ t, d: dd, tup: !!tup, i: [instKey] });
  }
  arr.sort((a, b) => a.t - b.t);
  resolveOverlaps(arr, t);
  return "added";
}

/* 位置 t から始まる音符 n の範囲に重なる他の音符を整理する */
function resolveOverlaps(arr, t) {
  const n = arr.find(x => x.t === t); if (!n) return;
  const end = n.t + n.d;
  for (let k = arr.length - 1; k >= 0; k--) {       // 後続で範囲内に始まる音符は削除
    const x = arr[k];
    if (x !== n && x.t > n.t && x.t < end) arr.splice(k, 1);
  }
  for (const x of arr) {                            // 手前の音符が食い込む場合は短くする
    if (x.t < n.t && x.t + x.d > n.t) {
      const nd = fitDur(n.t - x.t, x.tup);
      if (nd) x.d = nd; else x.d = 6;
      if (x.t + x.d > n.t) x.d = Math.max(6, n.t - x.t);
    }
  }
}

/* 楽器 instKey の head に最も近い音符(クリック位置の消去用) */
function removeNoteInst(measure, voice, t, instKey) {
  const arr = measure[voice]; const n = arr.find(x => x.t === t);
  if (!n) return false;
  n.i = n.i.filter(k => k !== instKey);
  if (n.i.length === 0) arr.splice(arr.indexOf(n), 1);
  return true;
}

/* ---- 休符の自動補完 ---- */
/* 声部 arr の隙間を休符で埋めた「音符+休符」のリスト(時間順)を返す */
function fillRests(arr, ticks, beat) {
  const out = []; let pos = 0;
  const pushGap = (from, to) => { for (const r of decomposeGap(from, to - from, beat)) out.push(r); };
  for (const n of arr) {
    if (n.t > pos) pushGap(pos, n.t);
    out.push({ t: n.t, d: n.d, tup: n.tup, i: n.i, rest: false, acc: !!n.acc, gh: !!n.gh, bm: n.bm, ref: n });
    pos = Math.max(pos, n.t + n.d);
  }
  if (pos < ticks) pushGap(pos, ticks);
  return out;
}

function decomposeGap(t, gap, beat) {
  const res = []; let guard = 0;
  while (gap > 0 && guard++ < 64) {
    let d = 0, tup = false;
    if (t % 12 === 0 && gap >= 12 && !(gap < 24 && gap % 12 !== 0)) {
      const pos = t % beat;
      const cands = beat === 72 ? [72, 24, 12, 6] : [192, 96, 48, 24, 12, 6];
      for (const c of cands) {
        if (c > gap || t % c !== 0) continue;
        if (c < beat && pos + c > beat) continue;       // 拍をまたがない
        if (c >= beat && pos !== 0) continue;
        d = c; break;
      }
    }
    if (!d) {                                           // 3連符の位置の休符
      tup = true;
      d = (t % 16 === 0 && gap >= 16) ? 16 : (t % 8 === 0 && gap >= 8) ? 8 : 0;
      if (!d) { d = gap; tup = false; }                 // 想定外: 残りをそのまま1つの休符に
    }
    res.push({ t, d, tup, i: [], rest: true });
    t += d; gap -= d;
  }
  return res;
}

/* ---- 連桁グループ ---- */
/* events: fillRests の出力。拍の中で連続する旗付き音符を連桁でつなぐ。戻り値: [[event,...], ...] */
function beamGroups(events, beat, ticks) {
  const wide = ticks && ticks % 96 === 0 && beat === 48;                 // 4/4・2/4: 8分音符は2拍ぶんまとめて連桁にする(ふつうの譜面の書き方)
  const groups = []; let cur = [];
  const flush = () => { if (cur.length >= 2) groups.push(cur); cur = []; };
  for (const e of events) {
    const f = durInfo(e.d, e.tup).flags;
    if (e.rest || f === 0) { flush(); continue; }
    if (cur.length) {
      const last = cur[cur.length - 1];
      const adjacent = last.t + last.d === e.t;
      const sameBeat = Math.floor(last.t / beat) === Math.floor(e.t / beat);
      const sameHalf = wide && last.d >= 24 && e.d >= 24 && !last.tup && !e.tup && Math.floor(last.t / 96) === Math.floor(e.t / 96);
      const connect = e.bm === "break" ? false : e.bm === "join" ? true : (sameBeat || sameHalf);     // 手動指定が優先
      if (!adjacent || !connect) flush();
    }
    cur.push(e);
  }
  flush();
  return groups;
}

/* 3連符を3つずつの組にする(数字「3」の表示用) */
function tupletGroups(events) {
  const groups = []; let cur = [];
  for (const e of events) {
    if (e.tup) { cur.push(e); if (cur.length === 3) { groups.push(cur); cur = []; } }
    else { if (cur.length) groups.push(cur); cur = []; }
  }
  if (cur.length) groups.push(cur);
  return groups;
}


/* ---- 音符の装飾(アクセント・ゴースト) ---- */
/* 全体tick [g0,g1) に始まる音符の flag("acc"|"gh") を切り替える。全部ついていれば外し、そうでなければ全部につける。戻り値: 対象の音符数 */
function toggleNoteFlag(score, g0, g1, flag) {
  const starts = measureStarts(score), targets = [];
  score.measures.forEach((m, k) => { if (m.sim && starts[k] < g1 && starts[k] + tsInfo(m.ts).ticks > g0) materializeSim(score, k); });
  score.measures.forEach((m, k) => ["up", "down"].forEach(v => m[v].forEach(n => {
    const g = starts[k] + n.t; if (g >= g0 && g < g1) targets.push(n);
  })));
  if (!targets.length) return 0;
  const allSet = targets.every(n => n[flag]);
  targets.forEach(n => { if (allSet) delete n[flag]; else n[flag] = true; });
  if (!allSet && flag === "gh") targets.forEach(n => delete n.acc);        // ゴーストとアクセントは両立しない
  if (!allSet && flag === "acc") targets.forEach(n => delete n.gh);
  return targets.length;
}

/* ---- 連桁のつなぎ/切り離し ---- */
/* 小節 measure の時刻 t にある音符と、その直前の音符とのつながりの状態を声部ごとに返す。
 * 戻り値: [{ voice, cur(音符), connected, sameBeat }]  (直前が休符・離れている・旗がない声部は含まない) */
function beamInfoAt(measure, t) {
  const info = tsInfo(measure.ts), out = [];
  for (const voice of ["up", "down"]) {
    const ev = fillRests(measure[voice], info.ticks, info.beat);
    const k = ev.findIndex(e => !e.rest && e.t === t);
    if (k < 1) continue;
    const cur = ev[k], prev = ev[k - 1];
    if (prev.rest || prev.t + prev.d !== cur.t) continue;
    if (durInfo(cur.d, cur.tup).flags < 1 || durInfo(prev.d, prev.tup).flags < 1) continue;
    const connected = beamGroups(ev, info.beat, info.ticks).some(g => g.includes(cur) && g.includes(prev));
    out.push({ voice, cur: cur.ref, connected, sameBeat: Math.floor(prev.t / info.beat) === Math.floor(cur.t / info.beat) });
  }
  return out;
}
/* 連桁のつなぎ/切り離し。force を省略すると反転、"break"=切る、"join"=つなぐ。戻り値: 変更した声部の数 */
function toggleBeamAt(measure, t, force) {
  let changed = 0;
  for (const b of beamInfoAt(measure, t)) {
    const want = force || (b.connected ? "break" : "join");
    if (want === "break" && b.connected) { b.cur.bm = "break"; changed++; }
    else if (want === "join" && !b.connected) { if (b.sameBeat) delete b.cur.bm; else b.cur.bm = "join"; changed++; }
  }
  return changed;
}

/* ---- 3連符への変換 / 解除 ---- */
/* 全体tick [g0,g1) に始まる音符を、通常 ⇄ 3連符 に変換する。
 *   通常→3連符: 長さ×4/3(16分→8分3連、32分→16分3連、8分→4分3連)  位置も同じ比率で変える
 *   3連符→通常: 長さ×3/4
 * 戻り値: { changed, skipped }  (変換できない音価の音符は skipped) */
function convertTuplet(score, g0, g1, toTup) {
  const starts = measureStarts(score); let changed = 0, skipped = 0;
  score.measures.forEach((m, k) => { if (m.sim && starts[k] < g1 && starts[k] + tsInfo(m.ts).ticks > g0) materializeSim(score, k); });
  const MAP_UP = { 24: 32, 12: 16, 6: 8 }, MAP_DOWN = { 32: 24, 16: 12, 8: 6 };
  score.measures.forEach((m, k) => {
    const ticks = tsInfo(m.ts).ticks;
    ["up", "down"].forEach(v => {
      const arr = m[v], conv = [], keep = [];
      for (const n of arr) {
        const g = starts[k] + n.t;
        if (g < g0 || g >= g1) { keep.push(n); continue; }
        if (!!n.tup === !!toTup) { keep.push(n); continue; }             // すでに目的の形
        const nd = (toTup ? MAP_UP : MAP_DOWN)[n.d];
        const longOne = toTup ? n.d === 24 : n.d === 32;
        const base = Math.floor(n.t / (longOne ? 96 : 48)) * (longOne ? 96 : 48);
        const rel = n.t - base, nt = base + (toTup ? rel * 4 / 3 : rel * 3 / 4);
        if (!nd || !Number.isInteger(nt) || nt + nd > ticks) { skipped++; keep.push(n); continue; }
        conv.push(Object.assign({}, n, { t: nt, d: nd, tup: !!toTup })); changed++;
      }
      if (!conv.length) return;
      conv.forEach(c => {
        const ex = keep.find(x => x.t === c.t);
        if (ex) { c.i.forEach(i => { if (!ex.i.includes(i)) ex.i.push(i); }); ex.i.sort((a, b) => INSTRUMENTS[a].h - INSTRUMENTS[b].h); }
        else keep.push(c);
      });
      keep.sort((a, b) => a.t - b.t);
      m[v] = keep;
      conv.forEach(c => resolveOverlaps(m[v], c.t));
      m[v].forEach(n => { if (n.bm && conv.some(c => c.t === n.t)) delete n.bm; });
    });
  });
  return { changed, skipped };
}

/* ---- 強弱記号・クレッシェンド ---- */
/* 強弱記号を置く。同じ記号がすでにあれば外す、別の記号があれば置き換える。戻り値: "added"|"removed"|"replaced" */
function setDynamic(measure, t, v) {
  measure.dyn = measure.dyn || [];
  const ex = measure.dyn.find(d => d.t === t);
  if (ex && ex.v === v) { measure.dyn.splice(measure.dyn.indexOf(ex), 1); return "removed"; }
  if (ex) { ex.v = v; return "replaced"; }
  measure.dyn.push({ t, v }); measure.dyn.sort((a, b) => a.t - b.t); return "added";
}
/* 強弱の変化記号(< >)。同じ位置・同じ種類があれば外す。len は tick数 */
function setHairpin(measure, t, len, kind) {
  measure.hp = measure.hp || [];
  const ex = measure.hp.find(h => h.t === t && h.k === kind);
  if (ex) { measure.hp.splice(measure.hp.indexOf(ex), 1); return "removed"; }
  measure.hp = measure.hp.filter(h => h.t !== t);                    // 同じ位置の逆向きは置き換え
  measure.hp.push({ t, len: Math.max(6, len | 0), k: kind }); measure.hp.sort((a, b) => a.t - b.t); return "added";
}
/* 時刻 t にある強弱記号・変化記号をすべて外す。戻り値: 外した数 */
function clearMarksAt(measure, t) {
  const a = (measure.dyn || []).length + (measure.hp || []).length;
  measure.dyn = (measure.dyn || []).filter(d => d.t !== t); measure.hp = (measure.hp || []).filter(h => h.t !== t);
  return a - measure.dyn.length - measure.hp.length;
}
/* ---- 小節繰り返し(%)・複数小節休符・二重線 ---- */
/* sim=true の小節は「直前の小節と同じ」。実際に鳴らす/描く元の小節を返す(%が続く時はさかのぼる) */
function simSource(score, i) { let k = i; while (k > 0 && score.measures[k].sim) k--; return score.measures[k]; }
function isEmptyMeasure(m) { return !m.sim && m.up.length === 0 && m.down.length === 0 && !(m.dyn || []).length && !(m.hp || []).length; }
/* mr=true の小節から続く「空の小節」の数(2以上のときだけまとめて表示。そうでなければ0) */
function multiRestRun(score, i) {
  const ms = score.measures, m = ms[i]; if (!m.mr || !isEmptyMeasure(m) || m.rs || m.re) return 0;
  let n = 1;
  for (let j = i + 1; j < ms.length; j++) { const x = ms[j]; if (!isEmptyMeasure(x) || x.ts !== m.ts || x.rs || x.re || x.mark || x.mr) break; n++; if (ms[j].re) break; }
  return n >= 2 ? n : 0;
}
/* sim の小節に手を入れる前に、元の小節の中身を写して通常の小節に戻す */
function materializeSim(score, i) {
  const m = score.measures[i]; if (!m || !m.sim) return false;
  const src = simSource(score, i), ticks = tsInfo(m.ts).ticks, cp = o => JSON.parse(JSON.stringify(o));
  m.up = cp(src.up).filter(n => n.t < ticks); m.down = cp(src.down).filter(n => n.t < ticks); m.sim = false; return true;
}
function measuresSame(a, b) {
  const pick = m => JSON.stringify([m.ts, m.up, m.down, m.dyn || [], m.hp || []]);
  return pick(a) === pick(b);
}
/* 直前と同じ内容の小節を %(sim) にまとめる。戻り値: まとめた数。mark・繰り返し記号のある小節は対象外 */
function autoSim(score, from, to) {
  let n = 0;
  for (let i = Math.max(1, from); i <= Math.min(to, score.measures.length - 1); i++) {
    const m = score.measures[i], prev = score.measures[i - 1];
    if (m.sim || m.mark || m.rs || m.mr || isEmptyMeasure(m) || prev.re) continue;
    const base = prev.sim ? simSource(score, i - 1) : prev;
    if (measuresSame(m, base) && !(m.dyn || []).length && !(m.hp || []).length) { m.up = []; m.down = []; m.sim = true; n++; }
  }
  return n;
}
/* 小節の中身(音符と記号)を空にする */
function clearMeasureContent(m) { m.up = []; m.down = []; m.dyn = []; m.hp = []; m.sim = false; }

/* 強弱記号と変化記号から、全体tick g の演奏の強さを返す関数を作る */
function makeLevelFn(score) {
  const starts = measureStarts(score), dyns = [], hps = [];
  score.measures.forEach((m, k) => {
    (m.dyn || []).forEach(d => { if (DYN_LEVELS[d.v]) dyns.push({ g: starts[k] + d.t, v: DYN_LEVELS[d.v] }); });
    (m.hp || []).forEach(h => hps.push({ gs: starts[k] + h.t, ge: starts[k] + h.t + h.len, k: h.k }));
  });
  dyns.sort((a, b) => a.g - b.g); hps.sort((a, b) => a.gs - b.gs);
  return function levelAt(g) {
    let cur = DEFAULT_LEVEL;
    const items = dyns.map(d => ({ g: d.g, d })).concat(hps.map(h => ({ g: h.gs, h }))).sort((a, b) => a.g - b.g || (a.d ? -1 : 1));
    for (const it of items) {
      if (it.g > g) break;
      if (it.d) { cur = it.d.v; continue; }
      const h = it.h, nd = dyns.find(d => d.g >= h.ge);
      const target = nd ? nd.v : Math.min(127, Math.max(10, cur + (h.k === "c" ? HAIRPIN_SPAN : -HAIRPIN_SPAN)));
      if (g < h.ge) return Math.round(cur + (target - cur) * ((g - h.gs) / Math.max(1, h.ge - h.gs)));
      cur = target;
    }
    return cur;
  };
}
/* 音符の演奏の強さ(1〜127) */
function noteVelocity(level, n) {
  let v = level;
  if (n.acc) v += ACCENT_BOOST;
  if (n.gh) v *= GHOST_RATIO;
  return Math.max(1, Math.min(127, Math.round(v)));
}

/* 演奏の表情(人間のドラマーのクセ): 拍の頭は強く・裏拍やこまかい音は弱く、バックビートのスネアはほんの少し遅れ、キックは少し前のめりに。
 * 戻り値: { dv: 強さの加算(-/+), dt: 時間のずれ(ミリ秒) }。楽譜は変えず、演奏の時だけ使う。 */
function expressionFor(inst, t, info, n) {
  const q = t % 48 === 0, off8 = t % 48 === 24, isMeasureHead = t === 0, back = info.ticks % 96 === 0 && t % 96 === 48;
  let dv = 0, dt = 0;
  if (inst === "hh_close" || inst === "hh_open" || inst === "ride") {
    const k = inst === "ride" ? 0.6 : 1;
    dv = (isMeasureHead ? 8 : q ? 3 : off8 ? -6 : -10) * k;
  } else if (inst === "snare") {
    dv = n && n.gh ? 0 : back ? 5 : -2; dt = n && n.gh ? 0 : back ? 5 : 1;
  } else if (inst === "kick") {
    dv = isMeasureHead ? 6 : q ? 1 : -4; dt = -3;
  } else if (inst === "crash") { dv = 6; dt = -2; }
  else if (inst === "hi_tom" || inst === "low_tom") { dv = 2; }
  return { dv, dt };
}

/* ---- 演奏順(繰り返し記号を展開) と 演奏イベント ---- */
/* 戻り値: [{ idx, start, ticks, gStart }]  start=展開後の開始tick, gStart=楽譜上の開始tick */
function buildSequence(score) {
  const starts = measureStarts(score), n = score.measures.length, seq = [], done = new Set();
  let i = 0, from = 0, acc = 0, guard = 0;
  while (i < n && guard++ < 10000) {
    const m = score.measures[i], ticks = tsInfo(m.ts).ticks;
    if (m.rs) from = i;
    seq.push({ idx: i, start: acc, ticks, gStart: starts[i] }); acc += ticks;
    if (m.re && !done.has(i)) { done.add(i); i = from; continue; }
    i++;
  }
  return seq;
}
/* 演奏イベントを作る。戻り値: { events:[{gt, i:[楽器], vel}], total, seq }  gt は展開後のtick */
function buildPlayEvents(score, opt) {
  const seq = buildSequence(score), level = makeLevelFn(score), ev = [], expr = !!(opt && opt.expr);
  seq.forEach(seg => {
    const m = score.measures[seg.idx], src = m.sim ? simSource(score, seg.idx) : m;
    ["up", "down"].forEach(v => src[v].filter(n => n.t < seg.ticks).forEach(n => {
      const e = { gt: seg.start + n.t, i: n.i.slice(), vel: noteVelocity(level(seg.gStart + n.t), n) };
      if (expr) { const info = tsInfo(m.ts), xs = n.i.map(k => expressionFor(k, n.t, info, n)); e.dv = xs.map(x => x.dv); e.dt = xs.map(x => x.dt); }
      ev.push(e);
    }));
  });
  ev.sort((a, b) => a.gt - b.gt);
  const last = seq[seq.length - 1];
  return { events: ev, total: last ? last.start + last.ticks : 0, seq };
}

/* ---- カーソルの移動 ---- */
/* 音価 step に合わせた位置へ動かす。戻り値: { m, t, overflow? }  (最後の小節の右端を超える時は overflow:true で動かない) */
function stepCursor(score, cur, step, dir) {
  const ticksOf = i => tsInfo(score.measures[i].ts).ticks;
  const m = cur.m, t = cur.t;
  if (dir > 0) {
    const nt = (Math.floor(t / step) + 1) * step;
    if (nt < ticksOf(m)) return { m, t: nt };
    if (m + 1 < score.measures.length) return { m: m + 1, t: 0 };
    return { m, t, overflow: true };
  }
  const nt = t % step === 0 ? t - step : Math.floor(t / step) * step;
  if (nt >= 0) return { m, t: nt };
  if (m > 0) { const tk = ticksOf(m - 1); return { m: m - 1, t: Math.floor((tk - 1) / step) * step }; }
  return { m, t: 0 };
}
function globalTick(score, cur) { return measureStarts(score)[cur.m] + cur.t; }

/* ---- 保存データの検証・移行 ---- */
/* 戻り値: { ok:true, score } | { ok:false, error } 。元データは書き換えない */
function migrateScore(raw) {
  try {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.measures) || raw.measures.length === 0)
      return { ok: false, error: "楽譜データの形式が正しくありません" };
    const ver = parseInt(String(raw.version || raw.schemaVersion || "0"), 10);
    const out = { schemaVersion: SCHEMA_VERSION, title: String(raw.title || "マイ・ドラム・スコア").slice(0, 80), subtitle: String(raw.subtitle || "").slice(0, 80), composer: String(raw.composer || "").slice(0, 80), simNotes: !!raw.simNotes,
                  bpm: clampInt(raw.bpm, 40, 240, 120), measures: [] };
    for (const m of raw.measures) {
      const ts = TIME_SIGS[m.ts || m.timeSignature] ? (m.ts || m.timeSignature) : "4/4";
      const nm = newMeasure(ts); nm.mark = String(m.mark || "").slice(0, 8);
      const ticks = tsInfo(ts).ticks;
      if (raw.schemaVersion >= 3 && (Array.isArray(m.up) || Array.isArray(m.down))) {
        for (const v of ["up", "down"]) for (const n of (m[v] || [])) {
          if (!Array.isArray(n.i)) continue;
          for (const k of n.i) if (INSTRUMENTS[k])
            toggleIfAbsent(nm, k, n.t | 0, n.d | 0, !!n.tup, ticks, v);
          const made = nm[v].find(x => x.t === (n.t | 0));
          if (made) {
            if (n.acc && !n.gh) made.acc = true;
            if (n.gh) made.gh = true;
            if (n.bm === "break" || n.bm === "join") made.bm = n.bm;
          }
        }
        if (raw.schemaVersion >= 4) {
          nm.rs = !!m.rs; nm.re = !!m.re; nm.sim = !!m.sim && out.measures.length > 0; nm.mr = !!m.mr; nm.dbl = !!m.dbl;
          for (const d of (Array.isArray(m.dyn) ? m.dyn : [])) if (d && DYN_LEVELS[d.v] && (d.t | 0) >= 0 && (d.t | 0) < ticks) setDynamic(nm, d.t | 0, d.v);
          for (const h of (Array.isArray(m.hp) ? m.hp : [])) if (h && (h.k === "c" || h.k === "d") && (h.t | 0) >= 0 && (h.t | 0) < ticks && (h.len | 0) >= 6 && (h.len | 0) <= 192 * 64) setHairpin(nm, h.t | 0, h.len | 0, h.k);
        }
      } else if (m.notes && ver >= 5) {                 // v5系: tick(96/全音符基準) → こちらは倍
        for (const key of Object.keys(m.notes)) for (const it of m.notes[key]) {
          if (it.isRest || !INSTRUMENTS[it.inst]) continue;
          const tup = !!it.isTuplet; const od = it.duration | 0;
          const d = tup ? 16 : od * 2;
          toggleIfAbsent(nm, it.inst, (parseInt(key, 10) || 0) * 2, d, tup, ticks);
        }
      } else if (m.notes) {                             // v2〜v4: 16分ステップ(1ステップ=12tick)
        for (const key of Object.keys(m.notes)) for (const it of (m.notes[key] || [])) {
          if (it.isRest || !INSTRUMENTS[it.inst]) continue;
          toggleIfAbsent(nm, it.inst, (parseInt(key, 10) || 0) * 12, 12, false, ticks);
        }
      } else if (typeof m === "object") {               // v1: {0:[{inst,length}],...}
        for (const key of Object.keys(m)) { if (!Array.isArray(m[key])) continue;
          for (const it of m[key]) if (it && INSTRUMENTS[it.inst])
            toggleIfAbsent(nm, it.inst, (parseInt(key, 10) || 0) * 12, 12, false, ticks); }
      }
      out.measures.push(nm);
    }
    return { ok: true, score: out };
  } catch (e) {
    return { ok: false, error: "読み込みに失敗しました: " + e.message };
  }
}
function toggleIfAbsent(measure, k, t, d, tup, ticks, voice) {
  const n = measure[voice || INSTRUMENTS[k].voice].find(x => x.t === t);
  if (n && n.i.includes(k)) return;
  if (!isValidDur(d, tup)) d = fitDur(Math.max(6, d), tup) || 12;
  if (t >= ticks) return;
  toggleNote(measure, k, t, d, tup, voice);
}
function clampInt(v, lo, hi, def) {
  const n = parseInt(v, 10); return isNaN(n) ? def : Math.min(hi, Math.max(lo, n));
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

if (typeof module !== "undefined") {
  module.exports = { TPQ, SCHEMA_VERSION, TIME_SIGS, INSTRUMENTS, DUR_INFO, NORMAL_DURS, DYN_LEVELS, DYN_ORDER, durInfo, isValidDur, fitDur,
    tsInfo, newMeasure, newScore, measureStarts, toggleNote, removeNoteInst, fillRests, decomposeGap,
    beamGroups, tupletGroups, migrateScore, escapeHtml, clampInt,
    toggleNoteFlag, beamInfoAt, toggleBeamAt, convertTuplet, setDynamic, setHairpin, clearMarksAt, clearMeasureContent,
    setMeasureTs, simSource, isEmptyMeasure, multiRestRun, materializeSim, measuresSame, autoSim,
    makeLevelFn, noteVelocity, expressionFor, buildSequence, buildPlayEvents, stepCursor, globalTick };
}
