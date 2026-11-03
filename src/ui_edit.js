/* ===== ui_edit.js : カーソル・範囲選択・キーボード操作・音楽記号の編集 =====
 * カーソル = 「次に音符を置く位置」。クリックした位置/最後に入力した位置に表示され、
 *            矢印キーで、いま選んでいる音符の長さに合わせた位置へ動く。
 * すべての編集は commit() を通るので、「戻す(Ctrl+Z)」でまとめて取り消せる。
 * (カーソルの移動そのものは、楽譜を変えないので履歴に入れない) */
const INST_KEYS = { c: "crash", h: "hh_close", o: "hh_open", r: "ride", t: "hi_tom", s: "snare", l: "low_tom", k: "kick", p: "hh_pedal", i: "sidestick" };
const BASE_KEYS = [192, 96, 48, 24, 12, 6];
const INST_ORDER = Object.keys(INSTRUMENTS);

/* ---- 位置の計算 ---- */
function stepNow() { const cd = currentDur(); return cd ? cd.d : state.base; }
function clampPos(c) {
  const ms = state.score.measures, m = Math.max(0, Math.min(ms.length - 1, c.m | 0));
  return { m, t: Math.max(0, Math.min(tsInfo(ms[m].ts).ticks - 1, c.t | 0)) };
}
function locateGlobal(g) {                                   // 全体tick → { m, t }
  const st = measureStarts(state.score);
  for (let k = st.length - 1; k >= 0; k--) if (g >= st[k]) return { m: k, t: g - st[k] };
  return { m: 0, t: 0 };
}
/* 選択範囲 [g0, g1) (全体tick)。範囲がなければ null。g1 は最後のマスの終わりまで含める */
function selectionRange() {
  if (!state.cursor || !state.anchor) return null;
  const a = globalTick(state.score, state.anchor), c = globalTick(state.score, state.cursor);
  if (a === c) return null;
  return { g0: Math.min(a, c), g1: Math.max(a, c) + stepNow() };
}
/* 操作の対象: 選択範囲があればそれ、なければカーソル位置ちょうど */
function targetRange() {
  const sel = selectionRange(); if (sel) return sel;
  const c = clampPos(state.cursor || { m: 0, t: 0 }), g = globalTick(state.score, c); return { g0: g, g1: g + 1 };
}
function needCursor() {
  if (state.cursor) return true;
  state.cursor = { m: 0, t: 0 }; return false;
}

/* ---- カーソルの移動 ---- */
function setCursor(c, extend) {
  c = clampPos(c);
  if (extend) { if (!state.anchor) state.anchor = state.cursor ? { m: state.cursor.m, t: state.cursor.t } : { m: c.m, t: c.t }; }
  else state.anchor = null;
  state.cursor = c; drawOverlay(); ensureCursorVisible();
}
function moveCursor(dir, extend) {
  const had = needCursor();
  if (!had && dir > 0 && !extend) { setCursor(state.cursor, false); return; }          // 最初の→は、まず先頭にカーソルを出すだけ
  const r = stepCursor(state.score, state.cursor, stepNow(), dir);
  if (r.overflow) { showStatus("最後の小節の終わりです(音符を置くと小節が増えます)"); return; }
  setCursor(r, extend);
}
function jumpMeasure(dir, extend) {
  needCursor(); const m = Math.max(0, Math.min(state.score.measures.length - 1, state.cursor.m + dir));
  setCursor({ m, t: 0 }, extend);
}
function cycleInstrument(dir) {
  let i = INST_ORDER.indexOf(state.inst); i = (i + dir + INST_ORDER.length) % INST_ORDER.length;
  state.inst = INST_ORDER[i]; state.mode = "input"; updateButtons(); drawOverlay();
  showStatus("パーツ: " + INSTRUMENTS[state.inst].name);
}

/* ---- カーソルと選択範囲の表示(楽譜SVGの上に重ねる。書き出しには含まれない) ---- */
function drawOverlay() {
  const g = $("overlay"); if (!g || !state.view) return;
  if (!state.cursor) { g.innerHTML = ""; return; }
  state.cursor = clampPos(state.cursor); if (state.anchor) state.anchor = clampPos(state.anchor);
  const L = LAYOUT, S = L.S, lay = state.view.layout; let s = "";
  const it = lay.measures[state.cursor.m]; if (!it) { g.innerHTML = ""; return; }
  const sel = selectionRange(), step = stepNow();
  if (sel) lay.measures.forEach(mm => {
    const a = Math.max(sel.g0, mm.gStart), b = Math.min(sel.g1, mm.gStart + mm.ticks); if (b <= a) return;
    const x1 = mm.xStart + L.HEAD_OFF + (a - mm.gStart) * mm.ppt - 6, x2 = Math.min(mm.x0 + mm.w - 2, mm.xStart + L.HEAD_OFF + (b - mm.gStart) * mm.ppt - 6);
    s += `<rect x="${f(x1)}" y="${f(mm.staffTop - 20)}" width="${f(Math.max(4, x2 - x1))}" height="${4 * S + 52}" fill="#3b82f6" opacity="0.2" rx="3"/>`;
  });
  const x = it.xStart + L.HEAD_OFF + state.cursor.t * it.ppt, top = it.staffTop, inst = INSTRUMENTS[state.inst];
  s += `<line id="curLine" x1="${f(x)}" y1="${f(top - 20)}" x2="${f(x)}" y2="${f(top + 4 * S + 32)}" stroke="#2563eb" stroke-width="2" stroke-dasharray="4 3"/>`
     + `<path d="M${f(x - 5)} ${f(top - 24)}L${f(x + 5)} ${f(top - 24)}L${f(x)} ${f(top - 17)}Z" fill="#2563eb"/>`
     + `<g opacity="0.5" style="color:${inst.color}">${headSvg(x, top + inst.h * S / 2, inst, { nv: 48 }).replace(/#000/g, inst.color)}</g>`;
  g.innerHTML = s;
}
/* カーソルが画面の外に出たら、見える位置までスクロールする */
function ensureCursorVisible() {
  const el = $("curLine"), host = $("scoreHost"); if (!el || !host) return;
  const r = el.getBoundingClientRect(), hr = host.getBoundingClientRect();
  if (r.left < hr.left + 40) host.scrollLeft -= (hr.left + 40 - r.left);
  else if (r.right > hr.right - 40) host.scrollLeft += (r.right - hr.right + 40);
  if (r.top < 70) window.scrollBy(0, r.top - 120);
  else if (r.bottom > window.innerHeight - 40) window.scrollBy(0, r.bottom - window.innerHeight + 140);
}

/* ---- 音符の入力・削除(キーボード) ---- */
function previewVelocity(c) { return makeLevelFn(state.score)(globalTick(state.score, c)); }
function placeAt(instKey, advance) {
  const cd = currentDur(); if (!cd) { showStatus("この音価では3連符・付点を使えません", "err"); return; }
  const cur = clampPos(state.cursor || { m: 0, t: 0 }), ms = state.score.measures;
  state.inst = instKey; state.mode = "input"; materializeSim(state.score, cur.m);
  const res = toggleNote(ms[cur.m], instKey, cur.t, cd.d, cd.tup, placeVoice(instKey));
  if (res === "invalid") { showStatus("ここには置けません(小節の終わりを超えます)", "err"); return; }
  if (res === "added") playSound(instKey, 0, previewVelocity(cur));
  let next = cur;
  if (advance) {
    next = stepCursor(state.score, cur, cd.d, 1);
    if (next.overflow) { ms.push(newMeasure(ms[ms.length - 1].ts)); next = { m: cur.m + 1, t: 0 }; }
  }
  state.cursor = next; state.anchor = null; commit(); ensureCursorVisible();
}
function removeAtCursor(back) {
  const had = needCursor(); const c = clampPos(state.cursor); materializeSim(state.score, c.m); const m = state.score.measures[c.m];
  const n = m.up.length + m.down.length;
  m.up = m.up.filter(x => x.t !== c.t); m.down = m.down.filter(x => x.t !== c.t);
  const removed = n - m.up.length - m.down.length;
  if (removed) { if (back) state.cursor = stepCursor(state.score, c, stepNow(), -1); state.anchor = null; commit(); ensureCursorVisible(); }
  else if (back) moveCursor(-1, false);
  else showStatus(had ? "カーソル位置に音符はありません" : "先に位置を選んでください");
}

/* ---- 音楽記号 ---- */
function applyFlag(flag, label) {
  needCursor(); const r = targetRange(), n = toggleNoteFlag(state.score, r.g0, r.g1, flag);
  if (!n) { showStatus("カーソル位置(または選択範囲)に音符がありません", "err"); return; }
  commit(); const on = state.score.measures.some(m => ["up", "down"].some(v => m[v].some(x => x[flag])));
  showStatus(label + "を切り替えました" + (on ? "" : ""));
}
function applyDynamic(v) {
  needCursor(); const c = clampPos(state.cursor), m = state.score.measures[c.m];
  const res = setDynamic(m, c.t, v); commit(); showStatus(res === "removed" ? `${v} を外しました` : `${v} を付けました`);
}
function cycleDynamic(dir) {
  needCursor(); const c = clampPos(state.cursor), m = state.score.measures[c.m], ex = (m.dyn || []).find(d => d.t === c.t);
  let i = ex ? DYN_ORDER.indexOf(ex.v) + dir : DYN_ORDER.indexOf("mf");
  if (ex && (i < 0 || i >= DYN_ORDER.length)) { m.dyn = m.dyn.filter(d => d.t !== c.t); commit(); showStatus("強弱記号を外しました"); return; }
  if (ex) m.dyn = m.dyn.filter(d => d.t !== c.t);
  setDynamic(m, c.t, DYN_ORDER[i]); commit(); showStatus("強弱記号: " + DYN_ORDER[i]);
}
function applyHairpin(kind) {
  needCursor(); const sel = selectionRange(), c = clampPos(state.cursor);
  let start, len;
  if (sel) { start = locateGlobal(sel.g0); len = sel.g1 - sel.g0 - stepNow(); if (len < 6) len = sel.g1 - sel.g0; }
  else { start = c; len = tsInfo(state.score.measures[c.m].ts).ticks - c.t; }
  if (len < 6) { showStatus("小節の終わりです。範囲を選んで(Shift+←→)から付けてください", "err"); return; }
  const res = setHairpin(state.score.measures[start.m], start.t, len, kind);
  commit(); showStatus(res === "removed" ? "変化記号を外しました" : (kind === "c" ? "クレッシェンド" : "デクレッシェンド") + "を付けました" + (sel ? "" : "(小節の終わりまで。長さは Shift+←→ で範囲を選んでから付けると変えられます)"));
}
function clearMarksHere() {
  needCursor(); const c = clampPos(state.cursor), n = clearMarksAt(state.score.measures[c.m], c.t);
  if (!n) { showStatus("ここに強弱記号・変化記号はありません"); return; }
  commit(); showStatus("記号を外しました");
}

/* ---- 連桁 ---- */
function applyBeam() {
  needCursor(); const r = targetRange(), st = measureStarts(state.score), list = [];
  state.score.measures.forEach((m, k) => { if (m.sim && st[k] < r.g1 && st[k] + tsInfo(m.ts).ticks > r.g0) materializeSim(state.score, k); });
  state.score.measures.forEach((m, k) => {
    const ts = new Set(); ["up", "down"].forEach(v => m[v].forEach(n => { const g = st[k] + n.t; if (g >= r.g0 && g < r.g1) ts.add(n.t); }));
    ts.forEach(t => list.push([m, t]));
  });
  const infos = list.flatMap(([m, t]) => beamInfoAt(m, t));
  if (!infos.length) { showStatus("連桁を変えられる位置ではありません(直前に隣り合う音符が必要です)", "err"); return; }
  const force = infos.some(b => b.connected) ? "break" : "join";        // 1つでもつながっていれば全部切る。なければ全部つなぐ
  let n = 0; list.forEach(([m, t]) => { n += toggleBeamAt(m, t, force); });
  commit(); showStatus(force === "break" ? "連桁を切りました(もう一度押すとつながります)" : "連桁をつなぎました(もう一度押すと切れます)");
}

/* ---- 小節繰り返し(%)・まとめ表示 ---- */
function toggleSimHere() {                       // カーソル(または選択範囲)の小節を「前と同じ(%)」にする/戻す
  needCursor(); const r = selectionRange(), c = clampPos(state.cursor), st = measureStarts(state.score);
  const idxs = []; state.score.measures.forEach((m, k) => { const g0 = r ? r.g0 : st[c.m], g1 = r ? r.g1 : st[c.m] + 1; if (st[k] < g1 && st[k] + tsInfo(m.ts).ticks > g0) idxs.push(k); });
  if (idxs[0] === 0) idxs.shift(); if (!idxs.length) { showStatus("最初の小節は「前と同じ」にできません", "err"); return; }
  const allSim = idxs.every(k => state.score.measures[k].sim);
  idxs.forEach(k => { const m = state.score.measures[k]; if (allSim) materializeSim(state.score, k); else { m.up = []; m.down = []; m.dyn = []; m.hp = []; m.sim = true; } });
  commit(); showStatus(allSim ? "% を解除して、音符に戻しました" : `${idxs.length}小節を「前の小節と同じ(%)」にしました。もう一度押すと元に戻ります`);
}
function applyAutoSim() {                        // 同じ内容が続く小節を自動で % にまとめる
  const n = autoSim(state.score, 1, state.score.measures.length - 1);
  if (!n) { showStatus("まとめられる小節(直前と全く同じ小節)はありませんでした"); return; }
  commit(); showStatus(`${n}小節を % にまとめました。「戻す」で元に戻せます`);
}
function applyAutoMr() {                         // 空の小節が2つ以上続く所を「N小節休符」にまとめて表示
  const ms = state.score.measures; let runs = 0;
  for (let i = 0; i < ms.length; i++) {
    if (!isEmptyMeasure(ms[i]) || ms[i].rs || ms[i].re) continue;
    let j = i + 1; while (j < ms.length && isEmptyMeasure(ms[j]) && ms[j].ts === ms[i].ts && !ms[j].rs && !ms[j].re && !ms[j].mark) j++;
    if (j - i >= 2) { ms[i].mr = true; runs++; }
    i = j - 1;
  }
  if (!runs) { showStatus("空の小節が2つ以上続く所がありません"); return; }
  commit(); showStatus(`${runs}か所を「N小節休符」にまとめて表示しました(小節の設定で解除できます)`);
}

/* ---- 連符 ---- */
/* mode: "toggle"(あれば通常→3連符、なければ解除) | "to" | "from" */
function applyTuplet(mode) {
  needCursor(); const sel = selectionRange(), c = clampPos(state.cursor); let g0, g1;
  if (sel) { g0 = sel.g0; g1 = sel.g1; }
  else { const info = tsInfo(state.score.measures[c.m].ts), bt = Math.floor(c.t / info.beat) * info.beat, gs = globalTick(state.score, { m: c.m, t: bt }); g0 = gs; g1 = gs + info.beat; }
  const st = measureStarts(state.score), notes = [];
  state.score.measures.forEach((m, k) => ["up", "down"].forEach(v => m[v].forEach(n => { const g = st[k] + n.t; if (g >= g0 && g < g1) notes.push(n); })));
  if (!notes.length) { showStatus("この拍(または選択範囲)に音符がありません", "err"); return; }
  const toTup = mode === "to" ? true : mode === "from" ? false : notes.some(n => !n.tup);
  const r = convertTuplet(state.score, g0, g1, toTup);
  if (!r.changed) { showStatus(toTup ? "3連符にできる音符がありません(16分・32分・8分が対象です)" : "解除できる3連符がありません", "err"); return; }
  commit();
  showStatus((toTup ? "3連符にしました" : "3連符を解除しました") + ` (${r.changed}個${r.skipped ? "、変換できない音符" + r.skipped + "個はそのまま" : ""})`);
}

/* ---- カーソルから再生 ---- */
function playFromCursor() {
  if (Player.playing) { togglePlay(); return; }
  Player.rebuild(state.score); const c = clampPos(state.cursor || { m: 0, t: 0 });
  Player.pausedTick = Player.tickOf(c.m, c.t); togglePlay();
}

/* ---- キーボード ---- */
function onKeyDown(e) {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (e.isComposing) return;
  if (document.querySelector(".modal-bg.show")) { if (e.key === "Escape") document.querySelectorAll(".modal-bg.show").forEach(m => m.classList.remove("show")); return; }
  const ctrl = e.ctrlKey || e.metaKey, k = e.key, lk = k.length === 1 ? k.toLowerCase() : k;
  let handled = true;
  if (ctrl) {
    if (lk === "z") { e.shiftKey ? redo() : undo(); } else if (lk === "y") redo(); else handled = false;
  } else if (e.altKey) handled = false;
  else if (e.code === "Space") { e.shiftKey ? playFromCursor() : togglePlay(); }
  else if (k === "ArrowRight") moveCursor(1, e.shiftKey);
  else if (k === "ArrowLeft") moveCursor(-1, e.shiftKey);
  else if (k === "ArrowUp") cycleInstrument(-1);
  else if (k === "ArrowDown") cycleInstrument(1);
  else if (k === "PageDown") jumpMeasure(1, e.shiftKey);
  else if (k === "PageUp") jumpMeasure(-1, e.shiftKey);
  else if (k === "Home") setCursor({ m: 0, t: 0 }, e.shiftKey);
  else if (k === "End") setCursor({ m: state.score.measures.length - 1, t: 0 }, e.shiftKey);
  else if (k === "%") toggleSimHere();
  else if (k === "Enter") { placeAt(state.inst, e.shiftKey ? !state.auto : state.auto); }
  else if (k === "Backspace") removeAtCursor(true);
  else if (k === "Delete") removeAtCursor(false);
  else if (k === "Escape") { state.anchor = null; drawOverlay(); }
  else if (/^[1-6]$/.test(k) && !e.shiftKey) { setBase(BASE_KEYS[+k - 1]); }
  else if (k === ".") { state.dotted = !state.dotted; if (state.dotted) state.tuplet = false; updateButtons(); drawOverlay(); }
  else if (k === "/" || (e.shiftKey && e.code === "Digit3")) { state.tuplet = !state.tuplet; if (state.tuplet) state.dotted = false; updateButtons(); drawOverlay(); }
  else if (k === "<") applyHairpin("c");
  else if (k === ">") applyHairpin("d");
  else if (INST_KEYS[lk]) { placeAt(INST_KEYS[lk], e.shiftKey ? !state.auto : state.auto); }
  else if (lk === "a") applyFlag("acc", "アクセント");
  else if (lk === "g") applyFlag("gh", "ゴースト");
  else if (lk === "f") applyFlag(e.shiftKey ? "dr" : "fl", e.shiftKey ? "ドラッグ" : "フラム");
  else if (lk === "b") applyBeam();
  else if (lk === "m") applyTuplet("toggle");
  else if (lk === "d") cycleDynamic(e.shiftKey ? -1 : 1);
  else if (lk === "x") clearMarksHere();
  else if (lk === "e") { state.mode = state.mode === "erase" ? "input" : "erase"; updateButtons(); }
  else if (lk === "?") { openHelp(); }
  else handled = false;
  if (handled) {
    e.preventDefault();
    if (document.activeElement && document.activeElement.tagName === "BUTTON") document.activeElement.blur();   // ボタンに残ったフォーカスで Space/Enter が二重に働かないように
  }
}
function setBase(b) {
  state.base = b; state.mode = "input";
  if (state.tuplet && ![48, 24, 12].includes(b)) state.tuplet = false;
  if (state.dotted && ![96, 48, 24, 12].includes(b)) state.dotted = false;
  updateButtons(); drawOverlay();
}
function openHelp() { $("helpModal").classList.add("show"); }
