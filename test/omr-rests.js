// 休符・⊗・付点休符を使った拍の読み取りの確認(合成した楽譜。実在の楽譜は使わない)
const { chromium } = require("/opt/npm-tools/node_modules/playwright");
(async () => {
  const b = await chromium.launch(), p = await b.newPage(); let fail = 0;
  const ok = (c, m) => { console.log((c ? "ok: " : "NG: ") + m); if (!c) fail = 1; };
  await p.goto("file://" + process.cwd() + "/index.html"); await p.waitForTimeout(300);
  const r = await p.evaluate(() => {
    const S = 15.9, pad = 30, out = {};
    // 4分音符 + 付点8分休符 + 16分音符 + 2分休符 (音符と休符の横位置)
    const xs = [483, 540, 587, 617];
    out.dotted = omrQuantize(xs, 452.5, 241.5, 192, S, pad, false, [false, true, false, false]).map(q => q.t);
    // 等間隔の8分6つ + 先頭の4分
    const x2 = [631, 701, 748, 795, 841, 888, 935];
    out.eighths = omrQuantize(x2, 596, 377, 192, S, 31, false, x2.map(() => false)).map(q => q.t);
    // 16分の連続 (3連符に見えても、3連符にしない)
    const x3 = [219, 264, 308, 353, 397, 442, 472, 502, 531, 561];
    out.sixteenth = omrQuantize(x3, 169, 432, 192, S, 50, true, x3.map(() => false)).map(q => q.t);
    return out;
  });
  ok(r.dotted[1] === 48 && r.dotted[2] === 84, "付点8分休符のあとの16分音符が 84 になる " + JSON.stringify(r.dotted));
  ok(JSON.stringify(r.eighths) === "[0,48,72,96,120,144,168]", "4分のあとの8分が3連符にならない " + JSON.stringify(r.eighths));
  ok(r.sixteenth.slice(5).join() === "120,132,144,156,168", "16分の連続が3連符にならない " + JSON.stringify(r.sixteenth));
  await b.close(); process.exit(fail);
})();
