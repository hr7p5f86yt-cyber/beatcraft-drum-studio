// 声部の切り替え(1声=上向き・2声=下向き)のテスト
const { chromium } = require("playwright"); const path = require("path");
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1180, height: 820 } }); const errs = []; let bad = 0;
  p.on("pageerror", e => errs.push(String(e))); const ok = (c, m) => { console.log((c ? "ok: " : "NG: ") + m); if (!c) bad++; };
  await p.goto("file://" + path.resolve(process.argv[2] || "index.html")); await p.waitForTimeout(300);
  const r = await p.evaluate(() => {
    const o = {}; const m = state.score.measures[0]; clearMeasureContent(m);
    o.def = toggleNote(m, "hh_close", 0, 24, false) && m.up.length === 1 && m.down.length === 0;
    state.voice = "down"; o.pv = placeVoice("hh_close");
    toggleNote(m, "hh_close", 48, 24, false, placeVoice("hh_close")); o.down = m.down.length === 1 && m.down[0].i[0] === "hh_close";
    state.voice = "up"; toggleNote(m, "kick", 96, 24, false, placeVoice("kick")); o.kickUp = m.up.some(n => n.t === 96 && n.i.includes("kick"));
    state.voice = "auto";
    const re = migrateScore(JSON.parse(JSON.stringify(state.score))); o.keep = re.ok && re.score.measures[0].down.length === 1 && re.score.measures[0].up.some(n => n.t === 96);
    commit(); o.svg = document.querySelectorAll("#scoreSvg").length === 1;
    const before = document.getElementById("voiceBtn").textContent; cycleVoice(); o.label = before + ">" + document.getElementById("voiceBtn").textContent; cycleVoice(); cycleVoice();
    o.back = state.voice;
    return o;
  });
  console.log(JSON.stringify(r));
  ok(r.def, "標準では手=1声"); ok(r.pv === "down", "2声を選ぶと2声に入る"); ok(r.down, "ハイハットを2声に置けた"); ok(r.kickUp, "キックを1声に置けた");
  ok(r.keep, "保存→読み込みでも声部が保たれる"); ok(r.label.includes("1声"), "ボタン表示が切り替わる " + r.label); ok(r.back === "auto", "3回で自動に戻る");
  ok(!errs.length, "エラーなし " + errs.join("|")); console.log(bad ? "FAILED" : "ALL PASSED"); await b.close(); process.exit(bad ? 1 : 0);
})();
