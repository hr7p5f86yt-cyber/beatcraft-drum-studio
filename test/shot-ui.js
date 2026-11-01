const { chromium } = require("playwright"); const path = require("path");
(async () => {
  const b = await chromium.launch(); const out = process.argv[3] || "out/ui";
  for (const [name, w, h] of [["pc", 1280, 1000], ["ipad", 820, 1100]]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1.2 });
    const errs = []; p.on("pageerror", e => errs.push(String(e))); p.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
    await p.goto("file://" + path.resolve(process.argv[2])); await p.waitForTimeout(300);
    await p.evaluate(() => {
      const sc = state.score, A = sc.measures;
      for (let k = 0; k < 8; k++) toggleNote(A[0], "hh_close", k * 24, 24, false);
      toggleNote(A[0], "snare", 48, 48, false); toggleNote(A[0], "snare", 144, 48, false); toggleNote(A[0], "kick", 0, 48, false); toggleNote(A[0], "kick", 96, 48, false);
      for (let k = 0; k < 8; k++) toggleNote(A[1], "hh_close", k * 24, 24, false);
      toggleNote(A[1], "snare", 48, 48, false); toggleNote(A[1], "snare", 144, 48, false); toggleNote(A[1], "kick", 0, 48, false);
      [0, 16, 32].forEach(t => toggleNote(A[2], "snare", 48 + t, 16, true));
      toggleNote(A[2], "kick", 0, 48, false);
      setDynamic(A[0], 0, "p"); setHairpin(A[0], 0, 384, "c"); setDynamic(A[2], 0, "f");
      A[1].up.find(n => n.t === 48).acc = true; A[0].up.find(n => n.t === 24).gh = true;
      A[0].rs = true; A[3].re = true;
      commit(); state.cursor = { m: 1, t: 48 }; state.anchor = { m: 1, t: 24 }; state.inst = "snare"; updateButtons(); drawOverlay();
    });
    await p.waitForTimeout(100);
    await p.screenshot({ path: `${out}-${name}.png`, fullPage: true });
    console.log(name, errs.length ? errs : "no errors");
  }
  await b.close();
})();
