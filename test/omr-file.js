// 画像ファイルを読み取って、検出結果を重ねた画像を out/omr-file.png に出す: node test/omr-file.js index.html 画像.png [拍子]
const { chromium } = require("playwright"); const path = require("path"), fs = require("fs");
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  p.on("pageerror", e => console.log("pageerror", e));
  await p.goto("file://" + path.resolve(process.argv[2])); await p.waitForTimeout(300);
  const mime = process.argv[3].endsWith(".png") ? "image/png" : "image/jpeg", data = "data:" + mime + ";base64," + fs.readFileSync(process.argv[3]).toString("base64");
  const r = await p.evaluate(async ([data, ts]) => {
    const img = await new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.src = data; });
    let sc = 1; if (img.width > 2600) sc = 2600 / img.width;
    const w = Math.round(img.width * sc), h = Math.round(img.height * sc);
    const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
    const id = g.getImageData(0, 0, w, h); const t0 = performance.now();
    const r = omrRecognize(omrGray(id.data, w, h), w, h, { ts }); const ms = Math.round(performance.now() - t0);
    if (!r.ok) return { err: r.error };
    const dg = document.createElement("canvas"); dg.width = w; dg.height = h; const gg = dg.getContext("2d"), im = gg.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { const v = r.gray[i]; im.data[4 * i] = im.data[4 * i + 1] = im.data[4 * i + 2] = v; im.data[4 * i + 3] = 255; } gg.putImageData(im, 0, 0);
    const cols = { crash: "#f59e0b", hh_close: "#2563eb", hh_open: "#06b6d4", ride: "#8b5cf6", hi_tom: "#ec4899", snare: "#10b981", low_tom: "#f97316", kick: "#ef4444" };
    r.systems.forEach(sy => { sy.barX.forEach(x => { gg.strokeStyle = "red"; gg.beginPath(); gg.moveTo(x, sy.st.lines[0] - 14); gg.lineTo(x, sy.st.lines[4] + 14); gg.stroke(); }); sy.heads.forEach(q => { gg.strokeStyle = cols[q.inst]; gg.lineWidth = 2; gg.strokeRect(q.x - 7, q.y - 7, 14, 14); }); });
    const ms2 = omrToMeasures(r, ts); let notes = 0; ms2.forEach(m => ["up", "down"].forEach(v => m[v].forEach(n => { notes += n.i.length; })));
    return { png: dg.toDataURL("image/png"), info: { w, h, S: +r.S.toFixed(1), skew: +r.skew.toFixed(2), systems: r.systems.length, measures: r.measures.length, heads: omrCount(r), notes, ms } };
  }, [data, process.argv[4] || "4/4"]);
  if (r.err) { console.log("ERR", r.err); } else { fs.writeFileSync("out/omr-file.png", Buffer.from(r.png.split(",")[1], "base64")); console.log(JSON.stringify(r.info)); }
  await b.close();
})();
