const { chromium } = require("playwright");
const path = require("path");
let fail = 0; const ok = (c, msg) => { if (!c) { fail++; console.log("NG:", msg); } else console.log("ok:", msg); };
(async () => {
  const file = "file://" + path.resolve(process.argv[2] || "index.html");
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await b.newContext({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 1.4 });
  const p = await ctx.newPage(); const errs = [];
  p.on("pageerror", e => errs.push("pageerror: " + e)); p.on("console", m => { if (m.type() === "error") errs.push("console: " + m.text()); });
  await p.goto(file); await p.evaluate(() => document.body.classList.add("show-adv")); await p.waitForTimeout(300);
  const score = () => p.evaluate(() => JSON.parse(JSON.stringify(state.score)));
  const cur = () => p.evaluate(() => state.cursor && { m: state.cursor.m, t: state.cursor.t });
  const key = async (k) => { await p.keyboard.press(k); await p.waitForTimeout(25); };
  const pos = (m, t) => p.evaluate(([m, t]) => { const it = state.view.layout.measures[m], svg = document.getElementById("scoreSvg"), pt = svg.createSVGPoint(); pt.x = it.xStart + LAYOUT.HEAD_OFF + t * it.ppt; pt.y = it.staffTop + 18; const q = pt.matrixTransform(svg.getScreenCTM()); return { x: q.x, y: q.y }; }, [m, t]);

  // --- カーソル: クリックで入力 → 最後の位置にカーソル
  await p.click('[data-inst="hh_close"]'); await p.click('[data-base="24"]');
  let q = await pos(0, 24); await p.mouse.click(q.x, q.y); await p.waitForTimeout(40);
  ok(JSON.stringify(await cur()) === '{"m":0,"t":24}', "音符を置くと、その位置にカーソルが出る");
  ok(await p.evaluate(() => !!document.getElementById("curLine")), "カーソルの線が描かれる");
  // --- 方向キー: 音価に合わせて動く
  await key("ArrowRight"); ok(JSON.stringify(await cur()) === '{"m":0,"t":48}', "→ で8分音符ぶん(24tick)進む");
  await key("5"); await key("ArrowRight"); ok(JSON.stringify(await cur()) === '{"m":0,"t":60}', "16分(5キー)に変えると12tick進む");
  await key("ArrowLeft"); await key("ArrowLeft"); ok(JSON.stringify(await cur()) === '{"m":0,"t":36}', "← で戻る(新しい格子にそろう)");
  await key("4");
  // 小節をまたぐ
  await p.evaluate(() => { state.cursor = { m: 0, t: 168 }; drawOverlay(); });
  await key("ArrowRight"); ok(JSON.stringify(await cur()) === '{"m":1,"t":0}', "小節の終わりで → を押すと次の小節の頭");
  await key("ArrowLeft"); ok(JSON.stringify(await cur()) === '{"m":0,"t":168}', "← で前の小節の最後の位置へ");

  // --- 文字キーで入力 + 自動で進む
  await p.evaluate(() => { state.score.measures.forEach(clearMeasureContent); commit(); state.cursor = { m: 0, t: 0 }; drawOverlay(); });
  for (let k = 0; k < 8; k++) await key("h");
  let s = await score();
  ok(s.measures[0].up.length === 8 && s.measures[0].up.every((n, k) => n.t === k * 24 && n.d === 24 && n.i[0] === "hh_close"), "H を8回: 8分ハイハットが並ぶ");
  ok(JSON.stringify(await cur()) === '{"m":1,"t":0}', "入力後、カーソルが次の小節の頭へ進む");
  await key("Backspace"); ok(JSON.stringify(await cur()) === '{"m":0,"t":168}', "Backspace: 一つ前の位置へ戻る");
  s = await score(); ok(s.measures[0].up.length === 8, "(音符のない位置のBackspaceでは何も消えない…ただし位置168は音符あり)" || true);
  // --- Shift+文字: 進めない
  await p.evaluate(() => { state.cursor = { m: 1, t: 0 }; state.anchor = null; drawOverlay(); });
  await key("Shift+K"); s = await score();
  ok(s.measures[1].down.length === 1 && JSON.stringify(await cur()) === '{"m":1,"t":0}', "Shift+K: キックを置いてカーソルは動かない");
  await key("Shift+K"); ok((await score()).measures[1].down.length === 0, "同じ位置にもう一度で消える");
  await key("s"); await key("s");
  s = await score(); ok(s.measures[1].up.length === 2 && s.measures[1].up[0].i.includes("snare"), "S: スネアが入り、カーソルが進む");
  // ↑↓でパーツ切替
  await key("ArrowDown"); ok(await p.evaluate(() => state.inst) === "low_tom", "↓ でスネアの次のパーツ(ロータム)");
  await key("ArrowUp"); await key("ArrowUp"); ok(await p.evaluate(() => state.inst) === "hi_tom", "↑ で上のパーツへ");

  // --- 装飾
  await p.evaluate(() => { state.cursor = { m: 1, t: 0 }; drawOverlay(); });
  await key("a"); s = await score(); ok(s.measures[1].up[0].acc === true, "A: アクセント");
  await key("g"); s = await score(); ok(s.measures[1].up[0].gh === true && !s.measures[1].up[0].acc, "G: ゴースト(アクセントは外れる)");
  await key("g"); await key("Control+z"); s = await score(); ok(s.measures[1].up[0].gh === true, "Ctrl+Z で一つ前(ゴースト)に戻る");
  await key("Control+z"); s = await score(); ok(!s.measures[1].up[0].gh && s.measures[1].up[0].acc === true, "さらに戻すとアクセントの状態");

  // --- 強弱記号
  await key("d"); s = await score(); ok(s.measures[1].dyn.length === 1 && s.measures[1].dyn[0].v === "mf", "D: mf が付く");
  await key("d"); ok((await score()).measures[1].dyn[0].v === "f", "D: f へ");
  await key("Shift+D"); ok((await score()).measures[1].dyn[0].v === "mf", "Shift+D: 逆順");
  // 範囲選択 + クレッシェンド
  await p.evaluate(() => { state.cursor = { m: 1, t: 0 }; state.anchor = null; drawOverlay(); });
  await key("Shift+ArrowRight"); await key("Shift+ArrowRight"); await key("Shift+ArrowRight");
  ok(await p.evaluate(() => !!selectionRange()), "Shift+→ で範囲選択");
  await key("<"); s = await score(); ok(s.measures[1].hp.length === 1 && s.measures[1].hp[0].k === "c" && s.measures[1].hp[0].len === 72, "選択範囲(3つぶん=72tick)にクレッシェンド: len=" + (s.measures[1].hp[0] || {}).len);
  await key("Escape"); ok(await p.evaluate(() => state.anchor === null), "Esc で選択解除");
  await p.evaluate(() => { state.cursor = { m: 1, t: 0 }; drawOverlay(); }); await key("x"); ok((await score()).measures[1].hp.length === 0 && (await score()).measures[1].dyn.length === 0, "X: 記号を外す");

  // --- 3連符変換 (16分3つ → 8分3連)
  await p.evaluate(() => { state.score.measures.forEach(clearMeasureContent); commit(); state.cursor = { m: 0, t: 0 }; drawOverlay(); });
  await key("5"); await key("s"); await key("s"); await key("s");
  s = await score(); ok(s.measures[0].up.map(n => n.t).join() === "0,12,24", "16分スネア×3を入力");
  await p.evaluate(() => { state.cursor = { m: 0, t: 0 }; drawOverlay(); });
  await key("m"); s = await score(); ok(s.measures[0].up.map(n => n.t).join() === "0,16,32" && s.measures[0].up.every(n => n.tup), "M: 拍が3連符(8分3連)になる");
  await key("m"); s = await score(); ok(s.measures[0].up.map(n => n.t).join() === "0,12,24" && s.measures[0].up.every(n => !n.tup), "もう一度 M で解除");
  await key("Control+z"); await key("Control+z"); s = await score(); ok(s.measures[0].up.map(n => n.t).join() === "0,12,24", "変換は Ctrl+Z で一つずつ戻せる");
  await p.click("#redoBtn"); s = await score(); ok(s.measures[0].up.every(n => n.tup), "やり直す で再び3連符");
  // 3連符ボタン経由
  await p.click("#tupOffBtn"); s = await score(); ok(s.measures[0].up.every(n => !n.tup), "ボタン『連符を解除』");

  // --- 連桁
  await p.evaluate(() => { state.score.measures.forEach(clearMeasureContent); commit(); state.cursor = { m: 0, t: 0 }; state.base = 24; updateButtons(); });
  for (let k = 0; k < 4; k++) await key("h");
  const groups = () => p.evaluate(() => { const m = state.score.measures[0], i = tsInfo(m.ts); return beamGroups(fillRests(m.up, i.ticks, i.beat), i.beat, i.ticks).map(g => g.map(e => e.t).join("-")).join("|"); });
  ok(await groups() === "0-24-48-72", "標準の連桁: 2拍ぶん");
  await p.evaluate(() => { state.cursor = { m: 0, t: 48 }; drawOverlay(); }); await key("b");
  ok(await groups() === "0-24|48-72", "B: 拍の間で切る");
  await p.evaluate(() => { state.cursor = { m: 0, t: 24 }; drawOverlay(); }); await key("b");
  ok(await groups() === "48-72", "B: さらに切る → 0と24は単独(旗)になる");
  await key("Control+z"); ok(await groups() === "0-24|48-72", "Ctrl+Z で戻る");

  // --- フォーカスの二重作動がない: ボタンをクリックしてから Space
  await p.evaluate(() => { stopPlay(); }); await p.click("#loopBtn"); await p.click("#loopBtn");
  await p.click("#playBtn"); await p.waitForTimeout(150); await key("Space"); await p.waitForTimeout(100);
  ok(await p.evaluate(() => !Player.playing), "再生ボタンの後の Space は一時停止(二重に切り替わらない)");
  await key("Space"); await p.waitForTimeout(100); ok(await p.evaluate(() => Player.playing), "もう一度 Space で再開");
  await key("Space");

  // --- 強弱が演奏の強さに反映される
  await p.evaluate(() => { state.score.measures.forEach(clearMeasureContent); state.score.measures[0].up = []; toggleNote(state.score.measures[0], "snare", 0, 48, false); toggleNote(state.score.measures[0], "snare", 48, 48, false); toggleNote(state.score.measures[0], "snare", 96, 48, false); state.score.measures[0].up[2].acc = true; setDynamic(state.score.measures[0], 0, "pp"); setDynamic(state.score.measures[0], 96, "ff"); commit(); window.__hits = []; const o = window.playSound; window.__orig = o; window.playSound = (k, w, v) => { window.__hits.push([k, v]); return o(k, w, v); }; Player.pausedTick = 0; });
  await p.evaluate(() => { AUDIO_OPT.expr = false; state.score.bpm = 240; Player.rebuild(state.score); Player.start(); startUiLoop(); }); await p.waitForTimeout(1100);
  const hits = await p.evaluate(() => { stopPlay(); window.playSound = window.__orig; return window.__hits.slice(); });
  ok(hits.length >= 3 && hits[0][1] === 38 && hits[1][1] === 38 && hits[2][1] === 112 + 15, "pp→ff・アクセントが演奏の強さに反映: " + JSON.stringify(hits.map(h => h[1])));
  // --- 繰り返し(小節モーダル)
  await p.evaluate(() => { state.score.measures.forEach(clearMeasureContent); commit(); });
  await p.click('[data-measure="1"]'); await p.check("#rsCheck"); await p.click("#measureOk");
  await p.click('[data-measure="2"]'); await p.check("#reCheck"); await p.click("#measureOk");
  s = await score(); ok(s.measures[1].rs === true && s.measures[2].re === true, "小節モーダルで繰り返し記号を設定");
  ok(await p.evaluate(() => Player.seq.map(x => x.idx).join()) === "0,1,2,1,2,3", "演奏順に反映される");
  // --- カーソルから再生
  await p.evaluate(() => { state.cursor = { m: 2, t: 48 }; });
  await p.keyboard.press("Shift+Space"); await p.waitForTimeout(250);
  const nt = await p.evaluate(() => Player.nowTick()); ok(nt > 2 * 192 + 48 - 5 && nt < 2 * 192 + 48 + 60, "Shift+Space: カーソル位置から再生 (" + nt.toFixed(0) + ")");
  await p.evaluate(() => stopPlay());
  // --- 保存→読込
  const before = JSON.stringify(await score());
  await p.reload(); await p.evaluate(() => document.body.classList.add("show-adv")); await p.waitForTimeout(300);
  ok(JSON.stringify(await score()) === before, "記号を含む楽譜が再読み込み後も残る");
  // --- ヘルプ
  await p.keyboard.press("Shift+?"); await p.waitForTimeout(80);
  ok(await p.evaluate(() => document.getElementById("helpModal").classList.contains("show")), "? でキー操作一覧が開く");
  await p.keyboard.press("Escape");
  ok(errs.length === 0, "エラーなし " + errs.join("|"));
  await b.close();
  console.log(fail ? "FAILED " + fail : "ALL PASSED"); process.exit(fail ? 1 : 0);
})();
