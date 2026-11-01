/* ===== ui_dock.js : iPad向けの下部操作パネル =====
 * 画面の下に固定。大きなパッド(タップで「カーソル位置に入力」→次へ進む)、◀▶ ⌫、音価、範囲選択、拡大縮小、再生。
 * パッドは state.padPlace=false にすると「パーツを選ぶだけ」になる(旧操作・テスト用)。 */
state.padPlace = true; state.extend = false; state.zoom = 1;
const DOCK_DURS = [[192, "全"], [96, "2分"], [48, "4分"], [24, "8分"], [12, "16分"], [6, "32分"]];
const DOCK_SHORT = { crash: "クラッシュ", hh_close: "ハイハット", hh_open: "オープンHH", ride: "ライド", hi_tom: "ハイタム", snare: "スネア", low_tom: "フロア", kick: "キック" };

function buildDock() {
  const d = $("dock"); if (!d) return;
  const mk = (cls, txt, fn, extra) => { const b = document.createElement("button"); b.className = cls; b.textContent = txt; if (extra) Object.assign(b.dataset, extra); b.addEventListener("click", fn); return b; };
  const pads = document.createElement("div"); pads.className = "dk-row dk-pads";
  Object.keys(INSTRUMENTS).forEach(k => {
    const b = mk("dk-pad", DOCK_SHORT[k] || INSTRUMENTS[k].name, () => {
      if (state.padPlace) placeAt(k, state.auto); else { state.inst = k; state.mode = "input"; updateButtons(); drawOverlay(); }
    }, { dinst: k });
    b.style.background = INSTRUMENTS[k].color; pads.appendChild(b);
  });
  const nav = document.createElement("div"); nav.className = "dk-row";
  nav.append(
    mk("dk-btn", "◀", () => moveCursor(-1, state.extend)), mk("dk-btn", "▶", () => moveCursor(1, state.extend)),
    mk("dk-btn", "⌫", () => { if (!state.cursor) { removeAtCursor(false); return; } const r = stepCursor(state.score, state.cursor, stepNow(), -1); if (r.overflow) return; setCursor(r, false); removeAtCursor(false); }),
    mk("dk-btn", "↩", () => $("undoBtn").click(), { dundo: 1 }), mk("dk-btn", "↪", () => $("redoBtn").click(), { dredo: 1 }),
    mk("dk-btn", "範囲選択", () => { state.extend = !state.extend; if (!state.extend) { state.anchor = null; drawOverlay(); } updateButtons(); }, { dext: 1 }),
    mk("dk-btn", "小節選択", () => { needCursor(); const c = state.cursor, m = state.score.measures[c.m]; state.cursor = { m: c.m, t: 0 }; state.anchor = null; state.anchor = { m: c.m, t: 0 }; state.cursor = { m: c.m, t: Math.max(0, tsInfo(m.ts).ticks - stepNow()) }; drawOverlay(); }),
    mk("dk-btn", "追従", () => { state.follow = !state.follow; $("followChk").checked = state.follow; updateButtons(); }, { dfol: 1 }),
    mk("dk-btn", "－", () => setZoom(state.zoom - 0.2)), mk("dk-btn", "＋", () => setZoom(state.zoom + 0.2)),
    bpmBox(),
    mk("dk-btn dk-play", "▶ 再生", () => $("playBtn").click(), { dplay: 1 })
  );
  const dur = document.createElement("div"); dur.className = "dk-row";
  DOCK_DURS.forEach(([v, t]) => dur.appendChild(mk("dk-btn", t, () => setBase(v), { dbase: v })));
  dur.append(mk("dk-btn", "付点", () => $("dotBtn").click(), { ddot: 1 }), mk("dk-btn", "3連", () => $("tupBtn").click(), { dtup: 1 }),
    mk("dk-btn", "アクセント", () => $("accBtn").click()), mk("dk-btn", "ゴースト", () => $("ghostBtn").click()),
    mk("dk-btn", "強弱▼", () => cycleDynamic(-1)), mk("dk-btn", "強弱▲", () => cycleDynamic(1)), mk("dk-btn", "連桁", applyBeam), mk("dk-btn", "% 同じ", toggleSimHere), mk("dk-btn", "小節設定", () => { needCursor(); openMeasureModal(state.cursor.m); }),
    mk("dk-btn", "📷 取込", openImport),
    mk("dk-btn", "休符で進む", () => { needCursor(); const r = stepCursor(state.score, state.cursor, stepNow(), 1); if (!r.overflow) setCursor(r, state.extend); }));
  d.append(pads, nav, dur);
  document.body.classList.add("has-dock");
  $("advBtn").addEventListener("click", () => { document.body.classList.toggle("show-adv"); $("advBtn").classList.toggle("active", document.body.classList.contains("show-adv")); });
}
function bpmBox() {
  const w = document.createElement("label"); w.className = "dk-bpm"; w.innerHTML = '♩<input type="range" id="dkBpm" min="40" max="240" value="120"><b id="dkBpmVal">120</b>';
  w.querySelector("input").addEventListener("input", e => { const r = $("bpmRange"); r.value = e.target.value; r.dispatchEvent(new Event("input")); });
  return w;
}
function setZoom(z) {
  state.zoom = Math.max(0.5, Math.min(2.4, Math.round(z * 10) / 10));
  applyZoom(); showStatus("拡大率 " + Math.round(state.zoom * 100) + "%");
}
/* 拡大率 100% = 画面の幅いっぱい。60% なら画面幅の6割、200% なら2倍の幅(はみ出す分は横にスクロール) */
function applyZoom() {
  const s = $("scoreSvg"); if (!s) return;
  s.style.width = Math.round(state.zoom * 100) + "%"; s.style.minWidth = Math.round(860 * Math.min(1, state.zoom)) + "px";
}
function updateDock() {
  const d = $("dock"); if (!d) return;
  d.querySelectorAll("[data-dinst]").forEach(b => b.classList.toggle("active", b.dataset.dinst === state.inst));
  d.querySelectorAll("[data-dbase]").forEach(b => b.classList.toggle("active", +b.dataset.dbase === state.base));
  const q = (s) => d.querySelector(s);
  q("[data-ddot]").classList.toggle("active", state.dotted); q("[data-dtup]").classList.toggle("active", state.tuplet);
  q("[data-ddot]").disabled = $("dotBtn").disabled; q("[data-dtup]").disabled = $("tupBtn").disabled;
  q("[data-dfol]").classList.toggle("active", !!state.follow);
  q("[data-dext]").classList.toggle("active", !!state.extend);
  q("[data-dundo]").disabled = $("undoBtn").disabled; q("[data-dredo]").disabled = $("redoBtn").disabled;
  const br = $("bpmRange"), dr = $("dkBpm"); if (dr && dr.value !== br.value) { dr.value = br.value; $("dkBpmVal").textContent = br.value; }
  q("[data-dplay]").textContent = Player.playing ? "⏸ 停止" : "▶ 再生";
}
