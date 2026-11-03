// FLAC形式の音源を読み込めるか(Chromium で確認。ffmpeg で作った小さな FLAC を使う)
const { chromium } = require("/opt/npm-tools/node_modules/playwright"); const fs = require("fs"), path = require("path"), cp = require("child_process");
let bad = 0; const ok = (c, m) => { console.log((c ? "ok: " : "NG: ") + m); if (!c) bad++; };
(async () => {
  const dir = fs.mkdtempSync("/tmp/flac-"); const wav = path.join(dir, "snare_OH_F_1.wav"), flac = path.join(dir, "snare_OH_F_1.flac"), foot = path.join(dir, "hihatFoot_OH_MP_1.flac");
  // 0.3秒のノイズ入り減衰音を作る(著作物は使わない)
  cp.execSync(`ffmpeg -loglevel error -y -f lavfi -i "anoisesrc=d=0.3:c=pink:a=0.5" -af "afade=t=out:st=0.05:d=0.25" ${wav}`);
  cp.execSync(`ffmpeg -loglevel error -y -i ${wav} ${flac}`); fs.copyFileSync(flac, foot);
  const b = await chromium.launch(), p = await b.newPage(); p.on("pageerror", e => { console.log("ERR", e); bad++; });
  await p.goto("file://" + path.resolve(__dirname, "../index.html")); await p.waitForTimeout(300);
  const files = [flac, foot].map(f => ({ name: path.basename(f), b64: fs.readFileSync(f).toString("base64") }));
  const r = await p.evaluate(async fs => {
    const list = fs.map(f => { const bin = atob(f.b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new File([u], f.name, { type: "audio/flac" }); });
    const res = await loadSampleFiles(list); return { added: res.added, skipped: res.skipped, kit: Object.keys(SAMPLES.kit) };
  }, files);
  ok(r.added.snare === 1, "FLAC のスネアを読み込める: " + JSON.stringify(r.added));
  ok(r.added.hh_pedal === 1, "FLAC のペダルハイハットを読み込める");
  ok(r.skipped.length === 0, "読み込めなかったものがない: " + r.skipped.join(","));
  await b.close(); console.log(bad ? "FAILED" : "ALL PASSED"); process.exit(bad ? 1 : 0);
})();
