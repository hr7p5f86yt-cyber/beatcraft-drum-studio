// 読み取りエンジンの正解率テスト: 自作の楽譜を画像にして読み取り、元のデータと比べる
const { chromium } = require("playwright"); const path = require("path");
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = []; p.on("pageerror", e => errs.push(String(e))); p.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
  await p.goto("file://" + path.resolve(process.argv[2] || "index.html")); await p.waitForTimeout(300);
  const res = await p.evaluate(async () => {
    let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const mkScore = (nm) => {
      const sc = newScore(); sc.measures = [];
      for (let i = 0; i < nm; i++) {
        const m = newMeasure("4/4"); const sixteen = rnd() < 0.4;
        const hh = sixteen ? 12 : 24; for (let t = 0; t < 192; t += hh) toggleNote(m, rnd() < 0.1 && !sixteen ? "hh_open" : "hh_close", t, hh, false);
        [48, 144].forEach(t => toggleNote(m, "snare", t, hh, false));
        if (rnd() < 0.5) toggleNote(m, "snare", 168, hh, false);
        toggleNote(m, "kick", 0, 48, false); if (rnd() < 0.7) toggleNote(m, "kick", 96 + (rnd() < 0.5 ? 0 : 24), 24, false); if (rnd() < 0.3) toggleNote(m, "kick", 72, 24, false);
        
        if (rnd() < 0.2) { [0, 16, 32].forEach((t, k) => { toggleNote(m, ["hi_tom", "snare", "low_tom"][k], 144 + t, 16, true); }); }
        sc.measures.push(m);
      }
      return sc;
    };
    const toImg = (url) => new Promise((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ng; i.src = url; });
    const render = async (sc, scale, photo) => {
      const svg = scoreToSvgDocument(sc), img = await toImg("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg));
      let w = Math.round(1100 * scale), h = Math.round(img.height / 1100 * w * 1100 / 1100);
      h = Math.round(parseFloat(svg.match(/height="(\d+)"/)[1]) * scale);
      let c = document.createElement("canvas"); c.width = w; c.height = h; let g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
      if (photo) {
        const c2 = document.createElement("canvas"); c2.width = w; c2.height = h; const g2 = c2.getContext("2d");
        g2.fillStyle = "#e9e6dc"; g2.fillRect(0, 0, w, h); g2.save(); g2.translate(w / 2, h / 2); g2.rotate(photo.rot * Math.PI / 180); g2.translate(-w / 2, -h / 2); g2.filter = `blur(${photo.blur}px)`; g2.globalCompositeOperation = "multiply"; g2.drawImage(c, 0, 0); g2.restore();
        const gr = g2.createLinearGradient(0, 0, w, h); gr.addColorStop(0, "rgba(0,0,0,0.0)"); gr.addColorStop(1, "rgba(0,0,0,0.38)"); g2.globalCompositeOperation = "multiply"; g2.fillStyle = gr; g2.fillRect(0, 0, w, h);
        const id = g2.getImageData(0, 0, w, h); for (let i = 0; i < id.data.length; i += 4) { const n = (rnd() - 0.5) * photo.noise; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n; } g2.putImageData(id, 0, 0);
        const jpg = c2.toDataURL("image/jpeg", photo.q); const im2 = await toImg(jpg); c = document.createElement("canvas"); c.width = w; c.height = h; g = c.getContext("2d"); g.drawImage(im2, 0, 0);
      }
      const id = c.getContext("2d").getImageData(0, 0, w, h); return { g: omrGray(id.data, w, h), w, h };
    };
    const truth = sc => { const set = new Set(); sc.measures.forEach((m, mi) => ["up", "down"].forEach(v => m[v].forEach(n => n.i.forEach(k => set.add(mi + ":" + n.t + ":" + k))))); return set; };
    const found = r => { const set = new Set(); r.measures.forEach((m, mi) => m.slots.forEach(s => s.heads.forEach(q => set.add(mi + ":" + s.t + ":" + q.inst)))); return set; };
    const out = [];
    for (const cfg of [{ name: "きれい(S=9)", scale: 1 }, { name: "きれい(S=14)", scale: 1.5 }, { name: "拡大(S=18)", scale: 2 },
      { name: "写真風(弱) 傾き1°", scale: 1.6, photo: { rot: 1.0, blur: 0.6, noise: 14, q: 0.8 } }, { name: "写真風(強) 傾き2.2°・影・ノイズ", scale: 1.6, photo: { rot: -2.2, blur: 1.0, noise: 34, q: 0.55 } }]) {
      const sc = mkScore(8), img = await render(sc, cfg.scale, cfg.photo), t0 = performance.now();
      const r = omrRecognize(img.g, img.w, img.h, { ts: "4/4" }); const ms = Math.round(performance.now() - t0);
      if (!r.ok) { out.push({ name: cfg.name, error: r.error }); continue; }
      const T = truth(sc), F = found(r); let tp = 0; T.forEach(k => { if (F.has(k)) tp++; });
      // 位置が1小節ずれていないか(測定のための小節対応は順序どおり)
      const miss = [...T].filter(k => !F.has(k)).slice(0, 6), extra = [...F].filter(k => !T.has(k)).slice(0, 6);
      out.push({ name: cfg.name, ms, S: +r.S.toFixed(1), skew: +r.skew.toFixed(2), measures: r.measures.length, truth: T.size, found: F.size, recall: +(tp / T.size).toFixed(3), precision: +(tp / Math.max(1, F.size)).toFixed(3), miss, extra });
    }
    return out;
  });
  res.forEach(r => console.log(JSON.stringify(r)));
  console.log(errs.length ? "ERRORS " + errs.join("|") : "no page errors"); await b.close();
})();
