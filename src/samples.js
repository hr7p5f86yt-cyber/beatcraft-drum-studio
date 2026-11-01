/* ===== samples.js : 録音したドラムの音(サンプル)を読み込んで、合成音の代わりに鳴らす =====
 * ・ファイル名からパーツを自動判定(crash / ride / open hat / hat / snare / kick / tom)。パーツごとに選ぶこともできる
 * ・同じパーツのファイルが複数あれば、音の大きさ順に「弱い→強い」として、演奏の強さに合わせて選ぶ(同じ強さが複数あればランダム)
 * ・読み込んだ音は、可能ならこのブラウザ(IndexedDB)に保存して、次回から自動で使う。使えない環境では今回だけ有効
 * ・配布して良いライセンス(CC0 など)の音源だけを使うこと */
const SAMPLES = { kit: {}, on: true, persisted: false };      // kit[パーツ] = [{ buf, rms, name, bytes }] (rms の小さい順)
const SAMPLE_MAX_SEC = 6, SAMPLE_MAX_BYTES = 80 * 1024 * 1024;

function guessInstrument(name) {
  const n = name.toLowerCase().replace(/\.[a-z0-9]+$/, "");
  if (/crash|cr[ _-]?\d|splash|china/.test(n)) return "crash";
  if (/ride|bell/.test(n)) return "ride";
  if (/(open|opn|ohh|o[_ -]?hat).*(hat|hh)|(hat|hh).*(open|opn)|ohh/.test(n)) return "hh_open";
  if (/hi[_ -]?hat|hihat|(^|[^a-z])hh([^a-z]|$)|hat/.test(n)) return /pedal|foot|chick/.test(n) ? null : "hh_close";
  if (/snare|(^|[^a-z])sn([^a-z]|$)|rim/.test(n)) return "snare";
  if (/kick|bass[_ -]?drum|(^|[^a-z])bd([^a-z]|$)/.test(n)) return "kick";
  if (/floor|low|(^|[^a-z])ft|tom[_ -]?[3-9]/.test(n) && /tom|floor|ft/.test(n)) return "low_tom";
  if (/tom/.test(n)) return "hi_tom";
  return null;
}
function decodeBytes(bytes) {
  const OC = window.OfflineAudioContext || window.webkitOfflineAudioContext; const ctx = new OC(2, 1, 44100);
  return new Promise((ok, ng) => { const p = ctx.decodeAudioData(bytes.slice(0), ok, ng); if (p && p.catch) p.catch(ng); });
}
/* 先頭の無音を詰め、長すぎる末尾を切って、音の大きさ(rms)を測る */
function prepareSample(buf) {
  const ch = buf.numberOfChannels, sr = buf.sampleRate, len = buf.length, d = [];
  for (let c = 0; c < ch; c++) d.push(buf.getChannelData(c));
  let peak = 0; for (let c = 0; c < ch; c++) for (let i = 0; i < len; i++) { const a = Math.abs(d[c][i]); if (a > peak) peak = a; }
  if (peak <= 0.0005) return null;
  let s = 0; const th = peak * 0.03; outer: for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) if (Math.abs(d[c][i]) > th) { s = i; break outer; }
  s = Math.max(0, s - Math.round(0.002 * sr));
  const e = Math.min(len, s + Math.round(SAMPLE_MAX_SEC * sr)), n = e - s;
  const out = new AudioBuffer({ length: n, numberOfChannels: ch, sampleRate: sr });
  for (let c = 0; c < ch; c++) { const o = out.getChannelData(c); o.set(d[c].subarray(s, e)); const f = Math.min(n, Math.round(0.03 * sr)); for (let i = 0; i < f; i++) o[n - 1 - i] *= i / f; }
  const w = Math.min(n, Math.round(0.15 * sr)); let sum = 0;
  for (let c = 0; c < ch; c++) for (let i = 0; i < w; i++) sum += d[c][s + i] * d[c][s + i];
  return { buf: out, rms: Math.sqrt(sum / (w * ch)), peak };
}
function addSample(inst, name, bytes, decoded) {
  const p = prepareSample(decoded); if (!p) return false;
  const list = SAMPLES.kit[inst] || (SAMPLES.kit[inst] = []);
  list.push({ buf: p.buf, rms: p.rms, peak: p.peak, name, bytes }); list.sort((a, b) => a.rms - b.rms);
  const mx = Math.max(...list.map(x => x.peak)); list.forEach(x => { x.norm = 0.9 / mx; });      // パーツ内の一番大きい音を基準にそろえる(強弱の差は残す)
  return true;
}
function sampleBytes() { let t = 0; Object.values(SAMPLES.kit).forEach(l => l.forEach(x => { t += x.bytes.byteLength; })); return t; }
/* files: FileList。forceInst があればそのパーツに、なければファイル名から振り分ける。戻り値: { added:{パーツ:数}, skipped:[名前] } */
async function loadSampleFiles(files, forceInst) {
  const added = {}, skipped = [];
  for (const f of files) {
    const inst = forceInst || guessInstrument(f.name);
    if (!inst) { skipped.push(f.name + "(パーツを判定できません)"); continue; }
    if (sampleBytes() + f.size > SAMPLE_MAX_BYTES) { skipped.push(f.name + "(容量の上限)"); continue; }
    try { const bytes = await f.arrayBuffer(), dec = await decodeBytes(bytes); if (addSample(inst, f.name, bytes, dec)) added[inst] = (added[inst] || 0) + 1; else skipped.push(f.name + "(無音)"); }
    catch (e) { skipped.push(f.name + "(読み込めない形式)"); }
  }
  samplesSave(); return { added, skipped };
}
function clearSamples(inst) { if (inst) delete SAMPLES.kit[inst]; else SAMPLES.kit = {}; samplesSave(); }
function hasSamples(inst) { return SAMPLES.on && !!(SAMPLES.kit[inst] && SAMPLES.kit[inst].length); }

/* 演奏の強さ vel に合うサンプルを選ぶ */
function pickSample(inst, vel) {
  const list = SAMPLES.kit[inst], n = list.length; if (n === 1) return { s: list[0], nominal: vel };
  let idx = Math.min(n - 1, Math.floor((Math.max(1, Math.min(127, vel)) - 1) / 127 * n));
  if (n >= 3 && Math.random() < 0.25) idx = Math.max(0, Math.min(n - 1, idx + (Math.random() < 0.5 ? -1 : 1)));
  return { s: list[idx], nominal: (idx + 0.5) / n * 127 };
}

/* ---- 保存(IndexedDB。使えなければ何もしない) ---- */
function idbOpen() {
  return new Promise((ok, ng) => { try { const r = indexedDB.open("beatcraft_samples", 1); r.onupgradeneeded = () => r.result.createObjectStore("s", { keyPath: "id", autoIncrement: true }); r.onsuccess = () => ok(r.result); r.onerror = () => ng(r.error); } catch (e) { ng(e); } });
}
async function samplesSave() {
  try {
    const db = await idbOpen(), tx = db.transaction("s", "readwrite"), st = tx.objectStore("s"); st.clear();
    Object.entries(SAMPLES.kit).forEach(([inst, l]) => l.forEach(x => st.add({ inst, name: x.name, bytes: x.bytes })));
    await new Promise((ok, ng) => { tx.oncomplete = ok; tx.onerror = () => ng(tx.error); }); SAMPLES.persisted = true;
  } catch (e) { SAMPLES.persisted = false; }
}
async function samplesRestore() {
  try {
    const db = await idbOpen(), rows = await new Promise((ok, ng) => { const r = db.transaction("s").objectStore("s").getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => ng(r.error); });
    for (const x of rows) { try { addSample(x.inst, x.name, x.bytes, await decodeBytes(x.bytes)); } catch (e) { /* 壊れた1つは飛ばす */ } }
    SAMPLES.persisted = rows.length > 0; return rows.length;
  } catch (e) { return 0; }
}
if (typeof module !== "undefined") {
  module.exports = Object.assign(module.exports || {}, { guessInstrument });
}
