const { chromium } = require("playwright");
const path = require("path");
let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log("NG:", msg); } else console.log("ok:", msg); };

(async () => {
  const file = "file://" + path.resolve(process.argv[2] || "index.html");
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1.4 });
  const p = await ctx.newPage(); const errs = [];
  p.on("pageerror", e => errs.push("pageerror: " + e)); p.on("console", m => { if (m.type() === "error") errs.push("console: " + m.text()); });
  await p.goto(file); await p.evaluate(() => document.body.classList.add("show-adv")); await p.waitForTimeout(300);
  ok(errs.length === 0, "起動時にエラーなし " + errs.join("|"));

  // 楽譜上の (小節, tick) → 画面座標
  const pos = (m, t, voiceY) => p.evaluate(([m, t, vy]) => {
    const it = state.view.layout.measures[m], svg = document.getElementById("scoreSvg"), pt = svg.createSVGPoint();
    pt.x = it.xStart + LAYOUT.HEAD_OFF + t * it.ppt; pt.y = it.staffTop + (vy == null ? 18 : vy);
    const q = pt.matrixTransform(svg.getScreenCTM()); return { x: q.x, y: q.y };
  }, [m, t, voiceY]);
  const click = async (m, t) => { const q = await pos(m, t); await p.mouse.click(q.x, q.y); await p.waitForTimeout(40); };
  const score = () => p.evaluate(() => JSON.parse(JSON.stringify(state.score)));

  // 8分ハイハットを8つ置く
  await p.click('[data-inst="hh_close"]'); await p.click('[data-base="24"]');
  for (let k = 0; k < 8; k++) await click(0, k * 24);
  let s = await score();
  ok(s.measures[0].up.length === 8 && s.measures[0].up.every(n => n.d === 24), "8分ハイハット8個が置ける");
  // スネア(2,4拍)・キック
  await p.click('[data-inst="snare"]'); await click(0, 48); await click(0, 144);
  await p.click('[data-inst="kick"]'); await p.click('[data-base="48"]'); await click(0, 0);
  s = await score();
  ok(s.measures[0].up.find(n => n.t === 48).i.length === 2, "同じ位置に別楽器が重なる(和音)");
  ok(s.measures[0].up.length === 8, "ハイハットの8分は壊れない");
  ok(s.measures[0].down.length === 1, "キックは下の声部に入る");

  // 3連符
  await p.click('[data-inst="snare"]'); await p.click('[data-base="24"]'); await p.click("#tupBtn");
  for (let k = 0; k < 3; k++) await click(1, k * 16);
  s = await score();
  ok(s.measures[1].up.length === 3 && s.measures[1].up.every(n => n.tup && n.d === 16), "3連符が置ける(16tick×3)");
  await p.click("#tupBtn");

  // 消去モード: 近くの音符だけ消える
  await p.click("#modeErase");
  const q = await pos(0, 48, 13.5);   // スネアの高さ(h=3)
  await p.mouse.click(q.x, q.y); await p.waitForTimeout(40);
  s = await score();
  ok(!s.measures[0].up.find(n => n.t === 48).i.includes("snare") && s.measures[0].up.find(n => n.t === 48).i.includes("hh_close"), "消去は近くの音符だけ(ハイハットは残る)");
  await p.click("#modeInput");

  // 戻す/やり直す
  await p.click("#undoBtn"); s = await score();
  ok(s.measures[0].up.find(n => n.t === 48).i.includes("snare"), "戻すで消去を取り消せる");
  await p.click("#redoBtn");

  // 保存 → 再読み込みで復元
  const before = JSON.stringify(await score());
  await p.reload(); await p.evaluate(() => document.body.classList.add("show-adv")); await p.waitForTimeout(300);
  ok(JSON.stringify(await score()) === before, "再読み込み後も同じ楽譜(自動保存)");

  // 自己テスト
  await p.click("#testBtn"); await p.waitForTimeout(100);
  const tests = await p.evaluate(() => [...document.querySelectorAll("#testList .list-row")].map(e => e.textContent));
  ok(tests.length >= 8 && tests.every(t => t.startsWith("✅")), "自己テストがすべて合格 " + tests.filter(t => !t.startsWith("✅")).join("|"));
  await p.click('[data-close="testModal"]');

  // 保存→開く
  await p.click("#saveBtn"); await p.fill("#saveTitleInput", "テスト<b>曲</b>"); await p.click("#saveOk");
  await p.click("#loadBtn"); await p.waitForTimeout(100);
  const rows = await p.evaluate(() => [...document.querySelectorAll("#loadList .list-row span")].map(e => e.textContent));
  ok(rows.length === 1 && rows[0].includes("<b>曲</b>"), "保存リストに表示され、タイトルのHTMLは文字として出る");
  await p.click("#loadList .primary"); await p.waitForTimeout(100);
  ok(JSON.stringify((await score()).measures) === JSON.stringify(JSON.parse(before).measures), "保存した楽譜を開ける");

  // 再生: 時間の進み方(120BPM, 4/4 → 1小節2.0秒)
  await p.click("#playBtn"); await p.waitForTimeout(1200);
  const t1 = await p.evaluate(() => Player.nowTick());
  ok(t1 > 90 && t1 < 150, `1.2秒で約115tick進む (実測 ${t1.toFixed(1)})`);
  const ph = await p.evaluate(() => document.getElementById("playhead").getAttribute("visibility"));
  ok(ph === "visible", "再生中はプレイヘッドが見える");
  // 再生中にBPMを倍にしても位置が飛ばない
  const a = await p.evaluate(() => Player.nowTick());
  await p.evaluate(() => changeBpm(240)); const c = await p.evaluate(() => Player.nowTick());
  ok(Math.abs(c - a) < 12, `BPM変更で位置が飛ばない (${a.toFixed(1)} → ${c.toFixed(1)})`);
  await p.click("#playBtn");                       // 一時停止
  const pausedAt = await p.evaluate(() => Player.pausedTick);
  await p.waitForTimeout(300);
  ok(await p.evaluate(v => !Player.playing && Player.pausedTick === v, pausedAt) && pausedAt > 0, "一時停止で位置が保たれる");
  await p.click("#playBtn"); await p.waitForTimeout(200);
  ok((await p.evaluate(() => Player.nowTick())) >= pausedAt, "再開は続きから");
  await p.click("#stopBtn");
  ok(await p.evaluate(() => !Player.playing && Player.pausedTick === 0), "停止で先頭に戻る");
  // 末尾で自動停止(1回だけ)
  await p.evaluate(() => { state.score.bpm = 240; Player.pausedTick = Player.total - 20; });
  await p.click("#playBtn"); await p.waitForTimeout(900);
  ok(await p.evaluate(() => !Player.playing), "最後まで再生すると自動で止まる");

  await p.screenshot({ path: "out/e2e.png", fullPage: true });
  ok(errs.length === 0, "実行中もエラーなし " + errs.join("|"));
  await b.close();
  console.log(fail ? "FAILED " + fail : "ALL PASSED"); process.exit(fail ? 1 : 0);
})();
