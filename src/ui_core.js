/* ===== ui_core.js : 状態・描画・入力・再生UI・元に戻す ===== */
const $ = id => document.getElementById(id);
const state = { voice: "auto", follow: true, score: newScore(), inst: "hh_close", base: 24, dotted: false, tuplet: false, mode: "input", view: null,
                cursor: null, anchor: null, auto: true };
let history = [], hIdx = -1, rafId = 0, renderQueued = false, toastTimer = 0;
function currentBpmValue() { return state.score.bpm; }

/* ---- 通知 ---- */
function showStatus(msg, kind) {
  const el = $("statusMsg"); if (!el) return;
  el.textContent = msg; el.className = "toast " + (kind === "err" ? "err" : "ok"); el.style.display = "block";
  if (kind === "err") console.error(msg);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.style.display = "none"; }, kind === "err" ? 6000 : 2200);
}

/* ---- 音価 ---- */
function currentDur() {
  let d = state.base;
  if (state.tuplet) { const m = { 48: 32, 24: 16, 12: 8 }; return m[d] ? { d: m[d], tup: true } : null; }
  if (state.dotted) { const m = { 96: 144, 48: 72, 24: 36, 12: 18 }; return m[d] ? { d: m[d], tup: false } : null; }
  return { d, tup: false };
}
function snapOf(cd) { return cd.tup ? cd.d : Math.min(12, cd.d); }

/* ---- 描画 ---- */
function renderAll() {
  const r = buildScoreSvg(state.score); state.view = r;
  $("scoreHost").innerHTML = `<svg id="scoreSvg" viewBox="0 0 ${r.width} ${r.height}" xmlns="http://www.w3.org/2000/svg">${r.svg}<g id="overlay" pointer-events="none"></g><line id="playhead" x1="0" y1="0" x2="0" y2="0" stroke="#2563eb" stroke-width="2" opacity="0.65" visibility="hidden"/></svg>`;
  $("titleInput").value = state.score.title; $("subtitleInput").value = state.score.subtitle || ""; $("composerInput").value = state.score.composer || "";
  $("bpmVal").textContent = state.score.bpm; $("bpmRange").value = state.score.bpm;
  if (typeof applyZoom === "function") applyZoom();
  updateButtons(); drawOverlay();
}
function scheduleRender() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; renderAll(); }); }
function updateButtons() {
  document.querySelectorAll("[data-inst]").forEach(b => b.classList.toggle("active", b.dataset.inst === state.inst));
  document.querySelectorAll("[data-base]").forEach(b => b.classList.toggle("active", +b.dataset.base === state.base));
  $("dotBtn").classList.toggle("active", state.dotted); $("tupBtn").classList.toggle("active", state.tuplet);
  $("dotBtn").disabled = ![96, 48, 24, 12].includes(state.base) || state.tuplet;
  $("tupBtn").disabled = ![48, 24, 12].includes(state.base) || state.dotted;
  $("modeInput").classList.toggle("active", state.mode === "input"); $("modeErase").classList.toggle("active", state.mode === "erase"); $("modeSelect").classList.toggle("active", state.mode === "select");
  $("undoBtn").disabled = hIdx <= 0; $("redoBtn").disabled = hIdx >= history.length - 1;
  $("loopBtn").classList.toggle("active", Player.loop);
  $("playBtn").textContent = Player.playing ? "⏸ 一時停止" : "▶ 再生";
  if (typeof updateDock === "function") updateDock();
}

/* ---- 変更の確定(元に戻す履歴・再生データ更新・自動保存) ---- */
function commit(skipHistory) {
  if (!skipHistory) {
    history = history.slice(0, hIdx + 1); history.push(JSON.stringify(state.score));
    if (history.length > 60) history.shift(); hIdx = history.length - 1;
  }
  Player.rebuild(state.score); renderAll(); autoSave();
}
function restoreHistory(i) {
  hIdx = i; const r = migrateScore(JSON.parse(history[i]));
  if (r.ok) { state.score = r.score; Player.rebuild(state.score); renderAll(); autoSave(); }
}
function undo() { if (hIdx > 0) restoreHistory(hIdx - 1); }
function redo() { if (hIdx < history.length - 1) restoreHistory(hIdx + 1); }
function resetHistory() { history = [JSON.stringify(state.score)]; hIdx = 0; }

/* ---- 入力(クリック/タップ) ---- */
function svgPoint(ev) {
  const svg = $("scoreSvg"), pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}
function onScoreClick(ev) {
  const label = ev.target.closest && ev.target.closest("[data-measure]");
  if (label) { openMeasureModal(+label.dataset.measure); return; }
  if (!state.view) return;
  const p = svgPoint(ev);
  const it = state.view.layout.measures.find(m => p.x >= m.x0 && p.x < m.x0 + m.w && p.y >= m.sysTop && p.y < m.sysBottom);
  if (!it) return;
  if (state.mode === "erase") { eraseNear(it, p); return; }
  if (p.x < it.xStart - 2) return;
  const cd = currentDur();
  if (!cd) { showStatus("この音価では3連符・付点を使えません", "err"); return; }
  const snap = snapOf(cd), raw = (p.x - it.xStart - LAYOUT.HEAD_OFF) / it.ppt;
  const tick = Math.max(0, Math.round(raw / snap) * snap);
  if (tick >= it.ticks) return;
  if (state.mode === "select" || ev.shiftKey || state.extend) { const ex = (ev.shiftKey || state.extend) && !!state.cursor; setCursor({ m: it.idx, t: tick }, ex); return; }   // 位置の選択だけ(Shift+クリックで範囲選択)
  materializeSim(state.score, it.idx);
  const measure = state.score.measures[it.idx];
  const before = measure[placeVoice(state.inst)].find(n => n.t === tick);
  const res = toggleNote(measure, state.inst, tick, cd.d, cd.tup, placeVoice(state.inst));
  if (res === "invalid") { showStatus("ここには置けません(小節の終わりを超えます)", "err"); return; }
  if (res === "added") {
    playSound(state.inst);
    if (before && (before.d !== cd.d || before.tup !== cd.tup)) showStatus("同じ位置の音は、先に置いた音符の長さにそろえます");
  }
  state.cursor = { m: it.idx, t: tick }; state.anchor = null;
  commit();
}
/* 入力する声部: 自動(手は1声・足は2声)/ 1声 / 2声 */
function placeVoice(inst) { return state.voice === "up" || state.voice === "down" ? state.voice : INSTRUMENTS[inst].voice; }
const VOICE_LABEL = { auto: "声部:自動", up: "声部:1声(上向き)", down: "声部:2声(下向き)" };
function cycleVoice() {
  state.voice = state.voice === "auto" ? "up" : state.voice === "up" ? "down" : "auto";
  document.querySelectorAll("[data-voice-btn]").forEach(b => { b.textContent = VOICE_LABEL[state.voice]; b.classList.toggle("active", state.voice !== "auto"); });
  showStatus(state.voice === "auto" ? "声部: 自動(手で叩くものは1声、足で操作するものは2声)" : "声部: " + (state.voice === "up" ? "1声(符尾は上向き)" : "2声(符尾は下向き)") + " に入力します");
}
function eraseNear(it, p) {
  let best = null, bd = 20;
  state.view.heads.forEach(h => { if (h.m !== it.idx) return; const d = Math.hypot(h.x - p.x, h.y - p.y); if (d < bd) { bd = d; best = h; } });
  if (!best) { showStatus("消したい音符の近くをタップしてください"); return; }
  materializeSim(state.score, it.idx); removeNoteInst(state.score.measures[it.idx], best.voice, best.t, best.inst);
  state.cursor = { m: it.idx, t: best.t }; state.anchor = null; commit();
}

/* ---- 再生UI ---- */
function togglePlay() {
  try {
    if (Player.playing) { Player.pause(); } else { Player.rebuild(state.score); Player.start(); startUiLoop(); }
  } catch (e) { showStatus("再生できません: " + e.message, "err"); }
  updateButtons(); if (!Player.playing) hidePlayhead();
}
function stopPlay() { Player.stop(); hidePlayhead(); updateButtons(); }
function toggleLoop() { Player.loop = !Player.loop; updateButtons(); }
function startUiLoop() {
  if (rafId) return;
  const loop = () => {
    rafId = 0;
    if (!Player.playing) { hidePlayhead(); lastFollowSys = null; updateButtons(); return; }
    if (Player.reachedEnd()) { Player.stop(); hidePlayhead(); updateButtons(); return; }
    movePlayhead(); rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
}
function movePlayhead() {
  const ph = $("playhead"); if (!ph || !state.view) return;
  const tick = Player.nowTick(), loc = Player.locate(tick);
  const it = loc && state.view.layout.measures[loc.idx];
  if (!it) return;
  const x = it.xStart + LAYOUT.HEAD_OFF + loc.t * it.ppt;
  ph.setAttribute("x1", x); ph.setAttribute("x2", x);
  ph.setAttribute("y1", it.staffTop - 10); ph.setAttribute("y2", it.staffTop + 4 * LAYOUT.S + 10);
  ph.setAttribute("visibility", "visible");
  if (state.follow) followPlayhead(it, x);
}
/* 再生中、演奏している段が画面の外に出ないように自動でスクロールする */
let lastFollowSys = null, lastFollowT = 0;
function followPlayhead(it, x) {
  const host = $("scoreHost"), svg = $("scoreSvg"); if (!host || !svg) return;
  const dock = $("dock"), dockH = dock && document.body.classList.contains("has-dock") ? dock.offsetHeight : 0;
  const vis = window.innerHeight - dockH, ph = $("playhead").getBoundingClientRect(), hr = host.getBoundingClientRect();
  const rowChanged = lastFollowSys !== it.sysTop;
  if (ph.right > hr.right - 30 || ph.left < hr.left + 30) host.scrollLeft += (ph.left - (hr.left + hr.width * 0.35));     // 横にはみ出す時(拡大中など)
  if ((rowChanged || ph.top < 40 || ph.bottom > vis - 20) && performance.now() - lastFollowT > 700) {
    lastFollowSys = it.sysTop; lastFollowT = performance.now();
    const top = window.scrollY + ph.top - vis * 0.28;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }
}
function hidePlayhead() { lastFollowSys = null; const ph = $("playhead"); if (ph) ph.setAttribute("visibility", "hidden"); }
function changeBpm(v) {
  const old = state.score.bpm, nv = clampInt(v, 40, 240, old);
  if (nv === old) return;
  state.score.bpm = nv; Player.changeTempo(nv, old);
  $("bpmVal").textContent = nv; scheduleRender(); autoSaveSoon();
}

/* ---- 小節の編集 ---- */
function addMeasure() { const last = state.score.measures[state.score.measures.length - 1]; state.score.measures.push(newMeasure(last.ts)); commit(); }
function removeLastMeasure() {
  const ms = state.score.measures; if (ms.length <= 1) { showStatus("これ以上、小節を減らせません", "err"); return; }
  const m = ms[ms.length - 1];
  if ((m.up.length || m.down.length || (m.dyn || []).length) && !confirm("最後の小節には音符があります。削除しますか？")) return;
  ms.pop(); commit();
}
function clearAllNotes() {
  if (!confirm("すべての音符と記号を消去します(小節数と拍子は残ります)。よろしいですか？")) return;
  state.score.measures.forEach(clearMeasureContent); commit();
}
function newBlankScore() {
  if (!confirm("新しい白紙の楽譜を始めます。いまの楽譜は「↩ 戻す」で戻せます(先に保存しておくと安心です)。よろしいですか？")) return;
  Player.stop(); hidePlayhead();
  const n = newScore(); state.score.title = n.title; state.score.bpm = n.bpm; state.score.measures = n.measures;
  state.cursor = { m: 0, t: 0 }; state.anchor = null; commit(); showStatus("新しい楽譜を開きました");
}
let editingMeasure = -1;
function openMeasureModal(i) {
  editingMeasure = i; const m = state.score.measures[i];
  $("measureTitle").textContent = `小節 ${i + 1} の設定`;
  $("tsSelect").value = m.ts; $("tsScope").value = "one"; $("markInput").value = m.mark || ""; $("rsCheck").checked = !!m.rs; $("reCheck").checked = !!m.re;
  $("simCheck").checked = !!m.sim; $("simCheck").disabled = i === 0; $("mrCheck").checked = !!m.mr; $("dblCheck").checked = !!m.dbl;
  $("measureModal").classList.add("show");
}
function applyMeasureModal() {
  const m = state.score.measures[editingMeasure]; if (!m) return closeModal("measureModal");
  const ts = $("tsSelect").value, ticks = tsInfo(ts).ticks, ms = state.score.measures, oldTs = m.ts;
  let targets = [m];
  const scope = $("tsScope").value;                                   // one | run(同じ拍子が続く範囲) | end(最後まで)
  if (ts !== oldTs && scope !== "one") { targets = []; for (let k = editingMeasure; k < ms.length; k++) { if (scope === "run" && ms[k].ts !== oldTs) break; targets.push(ms[k]); } }
  const lost = targets.some(x => x.ts !== ts && ["up", "down"].some(v => x[v].some(n => n.t + n.d > tsInfo(ts).ticks)));
  if (lost && !confirm("拍子を変えると、はみ出す音符が短くなったり削除されたりします。よろしいですか？")) return;
  targets.forEach(x => { if (x.ts !== ts) setMeasureTs(x, ts); });
  m.mark = $("markInput").value.trim().slice(0, 8); m.rs = $("rsCheck").checked; m.re = $("reCheck").checked;
  m.mr = $("mrCheck").checked; m.dbl = $("dblCheck").checked;
  if ($("simCheck").checked && !m.sim && editingMeasure > 0) { m.up = []; m.down = []; m.dyn = []; m.hp = []; m.sim = true; } else if (!$("simCheck").checked && m.sim) materializeSim(state.score, editingMeasure);
  closeModal("measureModal"); commit();
  if (targets.length > 1) showStatus(`${targets.length}小節の拍子を ${ts} にしました`);
}
function insertMeasureAfter() { const m = state.score.measures[editingMeasure]; state.score.measures.splice(editingMeasure + 1, 0, newMeasure(m.ts)); closeModal("measureModal"); commit(); }
function clearMeasure() { const m = state.score.measures[editingMeasure]; if (m && confirm("この小節の音符と記号をすべて消去しますか？")) { clearMeasureContent(m); closeModal("measureModal"); commit(); } }
function deleteMeasure() {
  if (state.score.measures.length <= 1) { showStatus("最後の1小節は削除できません", "err"); return; }
  if (confirm(`小節 ${editingMeasure + 1} を削除しますか？`)) { state.score.measures.splice(editingMeasure, 1); closeModal("measureModal"); commit(); }
}
function closeModal(id) { $(id).classList.remove("show"); }
