// 連桁(符尾の横線)の本数を手がかりにした拍の位置の読み取り: 実際の楽譜(PDF)で間違えた小節の「横位置と連桁の本数」だけを使う(楽譜そのものは含めない)
const { chromium } = require("playwright"); const path = require("path");
(async () => {
  const b = await chromium.launch(); const p = await b.newPage(); const errs = []; p.on("pageerror", e => errs.push(String(e)));
  await p.goto("file://" + path.resolve(process.argv[2] || "index.html")); await p.waitForTimeout(300);
  const cases = await p.evaluate(() => {
    const q = (xs, nbs, c, W) => omrQuantize(xs, c, W, 192, 18.8, 34, true, xs.map(() => false), nbs).map(r => r.t + (r.tup ? "t" : ""));
    return {
      buzz: q([258, 313, 369, 408, 460, 492, 523, 591, 639, 670], [1, 1, 1, 1, 2, 2, 1, 1, 2, 2], 233, 459),                  // ロールの音のあと16分が1つ早くなりやすい
      crash: q([257, 312, 344, 375, 406, 438, 472, 504, 535, 573, 607, 639, 670], [1, 1, 2, 2, 1, 0, 3, 3, 1, 0, 2, 2, 2], 232, 460),   // 最初の音が24に読まれ、別の声(バスドラム)が混ざる
      mixedTup: omrQuantize([1644, 1698, 1753, 1792, 1824, 1856, 1888, 1919, 1969, 2002, 2053], 1618, 458, 192, 18.875, 34, true, new Array(11).fill(false), [1, 1, 1, 2, 2, 2, 2, 1, 2, 2, 2]).map(r => r.t + (r.tup ? "t" : "")),   // 8分と16分が混ざる組は3連符にしない
      noBeams: q([258, 313, 369, 424, 480, 535, 590, 646], [0, 0, 0, 0, 0, 0, 0, 0], 233, 459),                                  // 連桁が分からないときは今まで通り
    };
  });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b); let bad = 0;
  const ck = (n, got, want) => { if (!same(got, want)) { bad++; console.log("NG", n, JSON.stringify(got), "!=", JSON.stringify(want)); } else console.log("ok:", n, JSON.stringify(got)); };
  ck("16分3つ組とロールの音", cases.buzz, ["0", "24", "48", "72", "96", "108", "120", "144", "168", "180"]);
  ck("最初の音が0・別の声が混ざる16分の連続", cases.crash, ["0", "24", "48", "60", "72", "96", "108", "120", "132", "144", "156", "168", "180"]);
  ck("8分と16分が混ざる組は3連符にならない", cases.mixedTup, ["0", "24", "48", "60", "72", "84", "96", "108", "132", "144", "168"]);
  ck("連桁が分からないときは8分の並び", cases.noBeams, ["0", "24", "48", "72", "96", "120", "144", "168"]);
  console.log(errs.length ? "ERRORS " + errs.join("|") : "no page errors"); if (bad || errs.length) process.exitCode = 1; else console.log("ALL PASSED"); await b.close();
})();
