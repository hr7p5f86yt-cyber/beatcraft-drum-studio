// 数字の形の判定(omrDigitShape)のテスト: 休符の小節数・テンポに使う。2・4・5・6 を取り違えないこと
const { chromium } = require("playwright"); const path = require("path");
(async () => {
  const b = await chromium.launch(), p = await b.newPage(); let bad = 0; const errs = [];
  p.on("pageerror", e => errs.push(String(e)));
  await p.goto("file://" + path.resolve(process.argv[2] || "index.html")); await p.waitForTimeout(300);
  const r = await p.evaluate(() => {
    const out = [];
    for (const fam of ["Times New Roman", "Arial", "Georgia", "DejaVu Sans", "DejaVu Serif", "Liberation Serif", "Noto Serif CJK JP"]) for (const wt of ["bold", "normal"]) for (const d of "1245679") {
      const cv = document.createElement("canvas"); cv.width = 160; cv.height = 140; const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 160, 140); g.fillStyle = "#000"; g.font = wt + " 90px '" + fam + "'"; g.fillText(d, 30, 105);
      const dd = g.getImageData(0, 0, 160, 140).data, s = omrDigitShape((x, y) => dd[(y * 160 + x) * 4] < 128, 0, 0, 159, 139);
      if (!s || s.digit !== d) out.push(fam + " " + wt + " " + d + "→" + (s && s.digit));
    }
    return out;
  });
  const miss25 = r.filter(x => /[25]→/.test(x) || /[46]→/.test(x));
  console.log("読み違い(全体):", r.length, r.join(" | ")); 
  if (miss25.length) { console.log("NG: 2・4・5・6 の読み違い " + miss25.join(" | ")); bad++; } else console.log("ok: 2・4・5・6 はどの書体・太さでも読み違えない");
  if (r.length > 8) { console.log("NG: 読み違いが多い " + r.length); bad++; } else console.log("ok: 全体の読み違いが少ない(" + r.length + ")");
  if (errs.length) { console.log("NG: エラー " + errs.join("|")); bad++; }
  console.log(bad ? "FAILED" : "ALL PASSED"); await b.close(); process.exit(bad ? 1 : 0);
})();
