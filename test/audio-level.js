// 実際に鳴らして、出力が無音でも音割れでもないことを確認する
const { chromium } = require("playwright"); const path = require("path");
(async () => {
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const p = await b.newPage(); const errs = [];
  p.on("pageerror", e => errs.push(String(e))); p.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
  await p.goto("file://" + path.resolve(process.argv[2])); await p.waitForTimeout(1500);   // 波形の準備を待つ
  const r = await p.evaluate(async () => {
    initAudio(); const an = audioCtx.createAnalyser(); an.fftSize = 2048; masterGain.connect(an);
    const buf = new Float32Array(2048); let peak = 0, loud = 0, samples = 0;
    const poll = setInterval(() => { an.getFloatTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v)); peak = Math.max(peak, m); if (m > 0.01) loud++; samples++; }, 20);
    const t = audioCtx.currentTime + 0.1;
    ["kick", "snare", "hh_close", "hh_open", "hi_tom", "low_tom", "ride", "crash"].forEach((k, i) => playSound(k, t + i * 0.35, 100));
    await new Promise(r => setTimeout(r, 3300)); clearInterval(poll);
    return { peak, loud, samples, state: audioCtx.state, rate: audioCtx.sampleRate };
  });
  console.log(JSON.stringify(r), errs.length ? errs : "no errors");
  const okk = r.peak > 0.05 && r.peak <= 1.0 && r.loud > 10 && !errs.length;
  console.log(okk ? "ok: 実際に音が出て、音割れしていない" : "NG"); await b.close(); process.exit(okk ? 0 : 1);
})();
