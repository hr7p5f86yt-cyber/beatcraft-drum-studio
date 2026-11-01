/* ===== audio.js : ドラム音源の再生 + 再生スケジューラ =====
 * 音: drumsynth.js が作った「強さ3段階 × 2種類」の波形を、強さに合わせて選んで鳴らす。
 *     毎回ほんの少し音程・音量・タイミングを揺らし(ヒューマナイズ)、部屋の響き(リバーブ)を足す。
 * 再生は Web Audio の時計(audioCtx.currentTime)を基準に先読みスケジュールする。
 * 位置は tick(1拍=48)で管理し、BPM変更・編集は再生中でも反映される。
 * 終了判定は rAF 側で1か所だけ行う(スケジューラ内から停止処理を呼ばない)。 */
const AUDIO_SR = 44100;
const AUDIO_OPT = { humanize: true, expr: true, room: 0.35 };           // room: 0〜1(部屋の響きの量)
const PAN = { crash: -0.45, hh_close: -0.3, hh_open: -0.3, ride: 0.42, hi_tom: -0.18, snare: 0.02, low_tom: 0.3, kick: 0 };
const SEND = { crash: 0.5, hh_close: 0.22, hh_open: 0.3, ride: 0.4, hi_tom: 0.55, snare: 0.6, low_tom: 0.55, kick: 0.25 };
let audioCtx = null, masterGain = null, dryBus = null, wetBus = null, roomGain = null, openHat = null;
const waveCache = {}, bufCache = {}, lastVariant = {};

function waveFor(key, layer, variant) {                     // 波形(Float32Array)。初回だけ計算してキャッシュ
  const id = key + "/" + layer + "/" + variant;
  return waveCache[id] || (waveCache[id] = synthDrum(key, layer, variant, AUDIO_SR));
}
function bufferFor(key, layer, variant) {
  const id = key + "/" + layer + "/" + variant;
  if (bufCache[id]) return bufCache[id];
  const w = waveFor(key, layer, variant), b = audioCtx.createBuffer(1, w.length, AUDIO_SR);
  if (b.copyToChannel) b.copyToChannel(w, 0); else b.getChannelData(0).set(w);
  return (bufCache[id] = b);
}
/* ページを開いた直後から少しずつ波形を作っておく(最初の再生で待たされないように) */
function prewarmWaves() {
  const jobs = [];
  Object.keys(INSTRUMENTS).forEach(k => DRUM_LAYERS.forEach((_, l) => { for (let v = 0; v < DRUM_VARIANTS; v++) jobs.push([k, l, v]); }));
  // よく使う中くらいの強さを先に
  jobs.sort((a, b) => Math.abs(a[1] - 1) - Math.abs(b[1] - 1));
  const step = () => { const j = jobs.shift(); if (!j) return; try { waveFor(j[0], j[1], j[2]); } catch (e) { console.error(e); } setTimeout(step, 4); };
  setTimeout(step, 200);
}

/* 部屋の響きのインパルス応答(最初の反射 + だんだん暗く減衰する拡散音)を計算で作る */
function makeImpulse(ctx) {
  const sr = ctx.sampleRate, len = Math.round(1.5 * sr), ir = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch); let seed = 1234 + ch * 77, lp = 0;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
    const pre = Math.round(0.006 * sr);
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr, k = 0.55 * Math.exp(-t / 0.22) + 0.06;       // 時間とともに高域が減る
      lp += (rnd() - lp) * k; d[i] = lp * Math.exp(-t / 0.32) * 1.6;
    }
    [[0.011, 0.5], [0.017, -0.4], [0.026, 0.35], [0.034, -0.3]].forEach(([tm, a], n) => { d[Math.round((tm + ch * 0.0017 * (n + 1)) * sr)] += a; });
  }
  return ir;
}

function initAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error("このブラウザは音声再生(Web Audio)に対応していません");
    audioCtx = new AC();
    const comp = audioCtx.createDynamicsCompressor();       // 同時発音の音割れ防止
    comp.threshold.value = -14; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.18;
    masterGain = audioCtx.createGain(); masterGain.gain.value = 0.95;
    dryBus = audioCtx.createGain();
    wetBus = audioCtx.createConvolver(); wetBus.buffer = makeImpulse(audioCtx);
    roomGain = audioCtx.createGain(); roomGain.gain.value = AUDIO_OPT.room * 1.2;
    dryBus.connect(comp); wetBus.connect(roomGain); roomGain.connect(comp);
    comp.connect(masterGain); masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
}
function setRoom(v) { AUDIO_OPT.room = Math.min(1, Math.max(0, v)); if (roomGain) roomGain.gain.value = AUDIO_OPT.room * 1.2; }

/* 1つの音を鳴らす。vel = 強さ(1〜127)。when = 鳴らす時刻(省略で今) */
function playSound(key, when, vel) {
  initAudio();
  vel = vel == null ? 84 : Math.max(1, Math.min(127, vel));
  let t = Math.max(when || 0, audioCtx.currentTime);
  const layer = vel < 61 ? 0 : vel < 101 ? 1 : 2, hu = AUDIO_OPT.humanize, useSample = typeof hasSamples === "function" && hasSamples(key);
  const src = audioCtx.createBufferSource(); let level;
  if (useSample) {                                                                       // 録音した音(サンプル)
    const pk = pickSample(key, vel); src.buffer = pk.s.buf;
    level = Math.min(1.5, Math.max(0.55, Math.pow(vel / Math.max(20, pk.nominal), 0.7))) * pk.s.norm * (hu ? 1 + (Math.random() - 0.5) * 0.08 : 1);
    if (hu) src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.012;
  } else {                                                                               // 計算で作った音
    const variant = lastVariant[key] = ((lastVariant[key] == null ? (Math.random() < 0.5 ? 1 : 0) : lastVariant[key]) + 1) % DRUM_VARIANTS;
    src.buffer = bufferFor(key, layer, variant);
    if (hu) src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.02;                   // ±1% の音程のゆらぎ
    const ratio = vel / DRUM_LAYERS[layer]; level = Math.min(1.5, Math.max(0.35, Math.pow(ratio, 1.25))) * (hu ? 1 + (Math.random() - 0.5) * 0.1 : 1);
  }
  const choke = audioCtx.createGain(), g = audioCtx.createGain(); g.gain.value = level;
  src.connect(choke); choke.connect(g);
  let out = g;
  if (audioCtx.createStereoPanner) { const p = audioCtx.createStereoPanner(); p.pan.value = PAN[key] || 0; g.connect(p); out = p; }
  out.connect(dryBus);
  const send = audioCtx.createGain(); send.gain.value = (SEND[key] || 0.3) * (useSample ? 0.5 : 1); g.connect(send); send.connect(wetBus);
  if (key === "hh_close" || key === "kick") {                                            // オープンハイハットをペダルで止める(閉じる)
    if (key === "hh_close" && openHat) {
      try { openHat.choke.gain.setTargetAtTime(0, t, 0.012); openHat.src.stop(t + 0.12); } catch (e) { console.error(e); }
      openHat = null;
    }
  }
  if (key === "hh_open") { if (openHat) { try { openHat.choke.gain.setTargetAtTime(0, t, 0.01); } catch (e) { /* 既に終了 */ } } openHat = { src, choke }; }
  src.start(t);
}

/* ---- 再生エンジン ---- */
const Player = {
  playing: false, loop: false,
  baseTick: 0, baseTime: 0,          // 「baseTime の時刻が baseTick に当たる」
  pausedTick: 0, nextIdx: 0, events: [], total: 0, seq: [], timer: 0,
  LOOK: 0.2, INTERVAL: 25,
  spt() { return 60 / currentBpmValue() / TPQ; },

  rebuild(score) {                    // 楽譜が変わったら呼ぶ(再生中でもOK)。繰り返し記号は展開済みの時間軸になる
    const r = buildPlayEvents(score, { expr: AUDIO_OPT.expr });
    this.events = r.events; this.total = r.total; this.seq = r.seq;
    if (this.playing) this.nextIdx = this.indexAtTick(this.horizonTick());
  },
  indexAtTick(tick) { let k = 0; while (k < this.events.length && this.events[k].gt < tick) k++; return k; },
  nowTick() { return this.playing ? this.baseTick + (audioCtx.currentTime - this.baseTime) / this.spt() : this.pausedTick; },
  horizonTick() { return this.baseTick + (audioCtx.currentTime + this.LOOK - this.baseTime) / this.spt(); },
  /* 展開後の時間軸 → { idx:楽譜の小節番号, t:小節内tick } */
  locate(tick) { const s = this.seq.find(x => tick >= x.start && tick < x.start + x.ticks); return s ? { idx: s.idx, t: tick - s.start } : null; },
  /* 小節 idx の時刻 t から再生する位置(展開後tick) */
  tickOf(idx, t) { const s = this.seq.find(x => x.idx === idx); return s ? s.start + t : 0; },

  start() {
    if (this.playing) return;
    initAudio();
    if (this.pausedTick >= this.total) this.pausedTick = 0;
    this.baseTick = this.pausedTick; this.baseTime = audioCtx.currentTime + 0.05;
    this.nextIdx = this.indexAtTick(this.baseTick); this.playing = true;
    clearInterval(this.timer); this.timer = setInterval(() => this.pump(), this.INTERVAL);
    this.pump();
  },
  pump() {
    if (!this.playing) return;
    const hz = this.horizonTick();
    while (this.nextIdx < this.events.length && this.events[this.nextIdx].gt < hz) {
      const e = this.events[this.nextIdx++];
      const t = this.baseTime + (e.gt - this.baseTick) * this.spt();
      const jitter = AUDIO_OPT.humanize ? (Math.random() - 0.5) * 0.006 * (e.vel < 60 ? 1.6 : 1) : 0;   // ±3ms(弱い音ほど少しルーズ)
      e.i.forEach((k, n) => {                                   // 演奏の表情: 拍ごとの強弱・タイミングのクセ + ごく小さなランダム
        let vel = e.vel, dt = 0;
        if (e.dv) { vel += e.dv[n] + (Math.random() - 0.5) * 7; dt = e.dt[n] / 1000; }
        playSound(k, t + jitter + dt, vel);
      });
    }
    if (this.loop && this.nextIdx >= this.events.length && hz >= this.total) {   // 先頭へ(時刻は連続)
      this.baseTick -= this.total; this.nextIdx = 0;
    }
  },
  changeTempo(newBpm, oldBpm) {      // BPM変更: 今の位置を保ったまま基準を取り直す
    if (!this.playing) return;
    const oldSpt = 60 / oldBpm / TPQ, now = audioCtx.currentTime;
    this.baseTick = this.baseTick + (now - this.baseTime) / oldSpt; this.baseTime = now;
    this.nextIdx = this.indexAtTick(this.horizonTick());
  },
  pause() {
    if (!this.playing) return;
    this.pausedTick = Math.min(this.nowTick(), this.total); this.halt();
  },
  stop() { this.pausedTick = 0; this.halt(); },
  halt() { this.playing = false; clearInterval(this.timer); this.timer = 0; },
  /* rAF から呼ぶ: 終端に達したら1回だけ true を返す */
  reachedEnd() { return this.playing && !this.loop && this.nowTick() >= this.total; }
};
