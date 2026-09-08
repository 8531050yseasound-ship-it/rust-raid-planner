/* capture.js — Rust のスクリーンショット／画面共有からインベントリを取り込む
 * 仕組み：画像上でバッグ(4×6)・手持ち(1×6)・装備(縦7/8)の範囲を囲む
 *   → 枠は自動補正（alignRect：自信のあるマスで位置±6px・サイズ±6px を探索してスナップ）
 *   → 各マスを N×N(32) に縮小し、全アイテムのアイコン(icons/64、3スケール)と照合
 *      スコア＝色差（テンプレをマスの背景色に合成して全画素比較）＋ 輪郭差（Sobel）×wEdge
 *   → 上位 top 件は ±1px ずらした特徴でも照合して最良を採る → 候補を表示 → 取り込み。
 * 合成スクショでの精度：38マス中37（枠を4pxずらしても37）。数量は画像から読まないので取り込み後に編集する。 */
(function () {
  let N = 32, NF = 64;
  const TUNE = { wEdge: 1.0, top: 10, inset: 0.08, scales: [1.1, 1.0, 0.9], align: true };   // 照合の重み（輪郭差）と 2 段階目に残す候補数
  const C = { img: null, w: 0, h: 0, rects: {}, mode: "main", results: null, drag: null, feats: null, stream: null, wearRows: 8 };
  const ZONE_DEF = { main: { cols: 6, rows: 4, label: "バッグ 4×6", color: "#ffb15c" }, belt: { cols: 6, rows: 1, label: "手持ち 1×6", color: "#7bc96f" }, wear: { cols: 1, rows: 8, label: "装備 縦8", color: "#3b9ddd" } };

  /* ---------- UI ---------- */
  const css = `
  #capModal .box{width:min(1100px,100%)}
  #capModal .body{padding:12px;display:flex;flex-direction:column;gap:10px;overflow:auto}
  .cap-src{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .cap-drop{border:2px dashed var(--line2);border-radius:8px;padding:18px;text-align:center;color:var(--muted);cursor:pointer}
  .cap-drop.over{border-color:var(--accent2);color:#fff}
  .cap-stage{position:relative;overflow:auto;max-height:52vh;border:1px solid var(--line);border-radius:6px;background:#000}
  .cap-stage canvas{display:block;cursor:crosshair}
  .cap-modes{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px;color:var(--muted)}
  .cap-modes button.on{background:var(--accent);border-color:var(--accent);color:#fff}
  .cap-res{display:flex;flex-direction:column;gap:8px}
  .cap-res h4{margin:0;font-size:12px;color:var(--muted)}
  .cap-grid{display:grid;gap:4px}
  .cap-cell{position:relative;width:48px;height:48px;border:1px solid var(--slotb);border-radius:6px;background:var(--slot);display:flex;align-items:center;justify-content:center;cursor:pointer}
  .cap-cell img{width:84%;height:84%;object-fit:contain}
  .cap-cell .cf{position:absolute;left:2px;bottom:0;font-size:9px;color:var(--dim)}
  .cap-cell.low{border-color:var(--warn)}
  .cap-cell.empty::after{content:"—";color:var(--line2)}
  .cap-cell:hover{border-color:var(--accent2)}
  .cap-video{max-width:100%;max-height:40vh;background:#000;border-radius:6px}
  .cap-prog{height:6px;background:var(--bg2);border-radius:3px;overflow:hidden}
  .cap-prog i{display:block;height:100%;background:var(--accent);width:0}
  `;
  document.head.append(el("style", {}, css));

  const modal = el("div", { id: "capModal", class: "modal text hidden" },
    el("div", { class: "box" },
      el("div", { class: "top" }, el("h3", {}, "📷 スクショ／画面共有から取り込み"), el("span", { class: "grow" }), el("button", { id: "capClose" }, "閉じる")),
      el("div", { class: "body" },
        el("div", { class: "cap-src" },
          el("button", { id: "capFileBtn", class: "primary" }, "🖼 画像ファイルを選ぶ"), el("input", { id: "capFile", type: "file", accept: "image/*", style: "display:none" }),
          el("button", { id: "capShare" }, "🖥 画面共有から取得"),
          el("span", { class: "help" }, "または Ctrl+V で貼り付け／ここへドロップ。Rust はウィンドウ表示（ボーダーレス）だと画面共有で選べます")),
        el("div", { id: "capDrop", class: "cap-drop" }, "ここに Rust のインベントリ画面（Tab で開く画面）のスクリーンショットをドロップ"),
        el("div", { id: "capShareBox", class: "hidden" }, el("video", { id: "capVideo", class: "cap-video", autoplay: "", muted: "", playsinline: "" }), el("div", { class: "toolbar", style: "margin-top:6px" }, el("button", { id: "capGrab", class: "primary" }, "📸 この画面を取り込む"), el("button", { id: "capStop" }, "共有を停止"))),
        el("div", { id: "capEditor", class: "hidden" },
          el("div", { class: "cap-modes" }, el("span", {}, "囲む範囲："),
            ...Object.keys(ZONE_DEF).map(k => el("button", { class: "small", "data-mode": k }, ZONE_DEF[k].label)),
            el("label", { title: "装備欄に含める段数（7=着用のみ、8=バックパック枠まで）" }, "装備の段数 ", el("select", { id: "capWearRows" }, el("option", { value: "8" }, "8"), el("option", { value: "7" }, "7"))),
            el("button", { id: "capAuto", class: "small ghost", title: "バッグの範囲から手持ちの位置を推定" }, "手持ちを自動推定"),
            el("button", { id: "capClearRects", class: "small ghost" }, "範囲をクリア"),
            el("span", { class: "grow" }), el("button", { id: "capRun", class: "primary" }, "🔍 認識する")),
          el("div", { class: "help" }, "画像の上でドラッグして、まず<b>バッグ 4×6</b> のマス目全体（外枠）を囲みます。次に手持ち、装備も同様に。枠の中は自動でマス目に分割されます。"),
          el("div", { class: "cap-stage" }, el("canvas", { id: "capCanvas" })),
          el("div", { id: "capProg", class: "cap-prog hidden" }, el("i")),
          el("div", { id: "capResults", class: "cap-res hidden" }),
          el("div", { class: "toolbar" }, el("button", { id: "capApply", class: "primary hidden" }, "✔ この内容を選択中の参加者に取り込む（上書き）"), el("button", { id: "capApplyFill", class: "hidden" }, "空きスロットだけ埋める"), el("span", { id: "capMsg", class: "help" }))))));
  document.body.append(modal);
  const q = s => modal.querySelector(s);

  function openCap() {
    const m = state.member(); if (!m) { toast("先に参加者を選んでください"); return; }
    if (!isMine(m)) { toast("他の人の投稿には取り込めません（コピーして自分用にしてから）"); return; }
    modal.classList.remove("hidden"); q("#capMsg").textContent = "";
  }
  function closeCap() { modal.classList.add("hidden"); stopShare(); }
  q("#capClose").addEventListener("click", closeCap);
  modal.addEventListener("mousedown", e => { if (e.target === modal) closeCap(); });
  q("#capFileBtn").addEventListener("click", () => q("#capFile").click());
  q("#capFile").addEventListener("change", e => { const f = e.target.files[0]; if (f) loadFile(f); e.target.value = ""; });
  const drop = q("#capDrop");
  drop.addEventListener("click", () => q("#capFile").click());
  for (const t of ["dragover", "dragenter"]) drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) loadFile(f); });
  document.addEventListener("paste", e => { if (modal.classList.contains("hidden")) return; const it = [...(e.clipboardData.items || [])].find(x => x.type.startsWith("image/")); if (it) { e.preventDefault(); loadFile(it.getAsFile()); } });

  async function loadFile(f) {
    try { const bmp = await createImageBitmap(f); setImage(bmp); } catch (e) { toast("画像を読み込めませんでした"); }
  }
  function setImage(bmp) {
    C.img = bmp; C.w = bmp.width; C.h = bmp.height; C.rects = {}; C.results = null;
    q("#capEditor").classList.remove("hidden"); q("#capResults").classList.add("hidden"); q("#capApply").classList.add("hidden"); q("#capApplyFill").classList.add("hidden");
    setMode("main"); draw();
    q("#capMsg").textContent = `画像 ${C.w}×${C.h}。バッグ 4×6 を囲んでください`;
  }

  /* ---------- 画面共有 ---------- */
  q("#capShare").addEventListener("click", async () => {
    try {
      C.stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
      const v = q("#capVideo"); v.srcObject = C.stream; q("#capShareBox").classList.remove("hidden");
      C.stream.getVideoTracks()[0].addEventListener("ended", stopShare);
    } catch (e) { toast("画面共有を開始できませんでした: " + (e.name || e.message)); }
  });
  q("#capGrab").addEventListener("click", async () => {
    const v = q("#capVideo"); if (!v.videoWidth) { toast("映像がまだ来ていません"); return; }
    const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext("2d").drawImage(v, 0, 0);
    setImage(await createImageBitmap(c));
  });
  function stopShare() { if (C.stream) { C.stream.getTracks().forEach(t => t.stop()); C.stream = null; } q("#capShareBox").classList.add("hidden"); }
  q("#capStop").addEventListener("click", stopShare);

  /* ---------- 範囲指定 ---------- */
  const cv = q("#capCanvas"), ctx = cv.getContext("2d");
  let scale = 1;
  function setMode(k) { C.mode = k; modal.querySelectorAll("[data-mode]").forEach(b => b.classList.toggle("on", b.dataset.mode === k)); }
  modal.querySelectorAll("[data-mode]").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));
  q("#capWearRows").addEventListener("change", e => { C.wearRows = +e.target.value; ZONE_DEF.wear.rows = C.wearRows; draw(); });
  q("#capClearRects").addEventListener("click", () => { C.rects = {}; C.results = null; q("#capResults").classList.add("hidden"); draw(); });
  q("#capAuto").addEventListener("click", () => {
    const r = C.rects.main; if (!r) { toast("先にバッグ 4×6 を囲んでください"); return; }
    const pitch = r.h / 4;                                            // 1マスの縦ピッチ
    C.rects.belt = { x: r.x, y: r.y + r.h + pitch * 0.35, w: r.w, h: pitch }; // Rust UI：手持ちはバッグの下、少し間が空く
    draw(); toast("手持ちの位置を推定しました。ずれていればドラッグで囲み直してください");
  });
  function draw() {
    if (!C.img) return;
    const maxW = Math.min(1040, modal.querySelector(".body").clientWidth - 30); scale = Math.min(1, maxW / C.w);
    cv.width = Math.round(C.w * scale); cv.height = Math.round(C.h * scale);
    ctx.drawImage(C.img, 0, 0, cv.width, cv.height);
    for (const k in C.rects) {
      const r = C.rects[k], d = ZONE_DEF[k]; ctx.strokeStyle = d.color; ctx.lineWidth = 2; ctx.strokeRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
      ctx.lineWidth = 1; ctx.globalAlpha = .7;
      for (let i = 1; i < d.cols; i++) { const x = (r.x + r.w * i / d.cols) * scale; ctx.beginPath(); ctx.moveTo(x, r.y * scale); ctx.lineTo(x, (r.y + r.h) * scale); ctx.stroke(); }
      for (let j = 1; j < d.rows; j++) { const y = (r.y + r.h * j / d.rows) * scale; ctx.beginPath(); ctx.moveTo(r.x * scale, y); ctx.lineTo((r.x + r.w) * scale, y); ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.fillStyle = d.color; ctx.font = "bold 12px sans-serif"; ctx.fillText(d.label, r.x * scale + 4, r.y * scale - 4);
    }
    if (C.drag) { const g = C.drag; ctx.setLineDash([4, 3]); ctx.strokeStyle = "#fff"; ctx.strokeRect(g.x0 * scale, g.y0 * scale, (g.x1 - g.x0) * scale, (g.y1 - g.y0) * scale); ctx.setLineDash([]); }
  }
  const pos = e => { const b = cv.getBoundingClientRect(); const p = e.touches ? e.touches[0] : e; return { x: (p.clientX - b.left) / scale, y: (p.clientY - b.top) / scale }; };
  const down = e => { if (!C.img) return; const p = pos(e); C.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; e.preventDefault(); };
  const move = e => { if (!C.drag) return; const p = pos(e); C.drag.x1 = p.x; C.drag.y1 = p.y; draw(); e.preventDefault(); };
  const up = e => {
    if (!C.drag) return; const g = C.drag; C.drag = null;
    const x = Math.min(g.x0, g.x1), y = Math.min(g.y0, g.y1), w = Math.abs(g.x1 - g.x0), h = Math.abs(g.y1 - g.y0);
    if (w > 20 && h > 20) { C.rects[C.mode] = { x, y, w, h }; if (C.mode === "main") { setMode("belt"); q("#capMsg").textContent = "次に 手持ち 1×6 を囲むか、「手持ちを自動推定」を押してください"; } else if (C.mode === "belt") { setMode("wear"); q("#capMsg").textContent = "必要なら 装備（縦）も囲んで、「認識する」を押してください"; } }
    draw();
  };
  cv.addEventListener("mousedown", down); cv.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  cv.addEventListener("touchstart", down, { passive: false }); cv.addEventListener("touchmove", move, { passive: false }); cv.addEventListener("touchend", up);

  /* ---------- 特徴量 ---------- */
  // Sobel 勾配の大きさ（形の特徴。明るさに依らず輪郭で照合するため）
  function sobel(gray, n) {
    const e = new Float32Array(n * n);
    for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
      const i = y * n + x;
      const gx = -gray[i - n - 1] - 2 * gray[i - 1] - gray[i + n - 1] + gray[i - n + 1] + 2 * gray[i + 1] + gray[i + n + 1];
      const gy = -gray[i - n - 1] - 2 * gray[i - n] - gray[i - n + 1] + gray[i + n - 1] + 2 * gray[i + n] + gray[i + n + 1];
      e[i] = Math.min(255, Math.hypot(gx, gy) / 4);
    }
    return e;
  }
  const tcan = {}; const tctx = n => { if (!tcan[n]) { const c = document.createElement("canvas"); c.width = n; c.height = n; tcan[n] = c.getContext("2d", { willReadFrequently: true }); } return tcan[n]; };
  // アイコン画像 → n×n のテンプレ特徴（rgb, alpha, 輪郭）
  function templateFeature(im, n, scale) {
    const g = tctx(n); g.clearRect(0, 0, n, n); const sz = n * scale, off = (n - sz) / 2; g.drawImage(im, off, off, sz, sz);
    const d = g.getImageData(0, 0, n, n).data; const rgb = new Uint8Array(n * n * 3), alpha = new Uint8Array(n * n), gray = new Float32Array(n * n); let cnt = 0;
    for (let p = 0; p < n * n; p++) { rgb[p * 3] = d[p * 4]; rgb[p * 3 + 1] = d[p * 4 + 1]; rgb[p * 3 + 2] = d[p * 4 + 2]; alpha[p] = d[p * 4 + 3]; if (alpha[p] > 96) cnt++; const a = alpha[p] / 255; gray[p] = a * (0.299 * rgb[p * 3] + 0.587 * rgb[p * 3 + 1] + 0.114 * rgb[p * 3 + 2]) + (1 - a) * 30; }
    return { rgb, alpha, edge: sobel(gray, n), cnt };
  }
  async function buildFeatures() {
    if (C.feats) return C.feats;
    const prog = q("#capProg"); prog.classList.remove("hidden"); const bar = prog.querySelector("i");
    const feats = []; let done = 0; C.imgs = {}; C.fine = new Map();
    const load = it => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = ico(it.s); });
    const list = ITEMS.slice();
    const t0 = performance.now();
    for (let i = 0; i < list.length; i += 120) {
      const imgs = await Promise.all(list.slice(i, i + 120).map(load));
      imgs.forEach((im, k) => {
        const it = list[i + k]; if (!im) return; C.imgs[it.s] = im;
        for (const s of TUNE.scales) { const f = templateFeature(im, N, s); if (f.cnt > 12) feats.push({ it, scale: s, ...f }); }
      });
      done += imgs.length; bar.style.width = Math.round(done / list.length * 100) + "%";
    }
    prog.classList.add("hidden"); C.feats = feats; console.log(`[capture] features: ${feats.length} in ${Math.round(performance.now() - t0)} ms`); return feats;
  }
  function fineFeature(it, scale) { const k = it.s + "@" + scale; let f = C.fine.get(k); if (!f) { f = templateFeature(C.imgs[it.s], NF, scale); C.fine.set(k, f); } return f; }

  /* ---------- 認識 ---------- */
  function cellFeature(r, d, col, row, n, dx = 0, dy = 0) {
    const cw = r.w / d.cols, ch = r.h / d.rows; const inset = TUNE.inset;          // マスの外周は枠なので除く
    const sx = r.x + cw * (col + inset + dx), sy = r.y + ch * (row + inset + dy), sw = cw * (1 - 2 * inset), sh = ch * (1 - 2 * inset);
    const g = tctx(n); g.clearRect(0, 0, n, n); g.drawImage(C.img, sx, sy, sw, sh, 0, 0, n, n);
    const d0 = g.getImageData(0, 0, n, n).data; const rgb = new Uint8Array(n * n * 3);
    for (let p = 0; p < n * n; p++) { rgb[p * 3] = d0[p * 4]; rgb[p * 3 + 1] = d0[p * 4 + 1]; rgb[p * 3 + 2] = d0[p * 4 + 2]; }
    // 背景色＝外周1ピクセルの中央値
    const ring = []; for (let p = 0; p < n * n; p++) { const x = p % n, y = (p / n) | 0; if (x === 0 || y === 0 || x === n - 1 || y === n - 1) ring.push([rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]]); }
    const med = k => { const a = ring.map(v => v[k]).sort((x, y) => x - y); return a[a.length >> 1]; };
    const bg = [med(0), med(1), med(2)];
    let diffPx = 0; const gray = new Float32Array(n * n);
    for (let p = 0; p < n * n; p++) { gray[p] = 0.299 * rgb[p * 3] + 0.587 * rgb[p * 3 + 1] + 0.114 * rgb[p * 3 + 2]; if (Math.abs(rgb[p * 3] - bg[0]) + Math.abs(rgb[p * 3 + 1] - bg[1]) + Math.abs(rgb[p * 3 + 2] - bg[2]) > 45) diffPx++; }
    return { rgb, bg, fill: diffPx / (n * n), edge: sobel(gray, n), n };
  }
  function scoreOf(cf, f) {
    // ① 色差：テンプレをマスの背景色に合成したものと、マス全体で比較（小さなアイコンが何にでも合う誤検出を防ぐ）
    // ② 形差：輪郭（Sobel）の差。暗いアイテムが暗い背景に溶けても輪郭で区別できる
    const rgb = cf.rgb, bg = cf.bg, ec = cf.edge, PX = cf.n * cf.n; let dc = 0, de = 0; const t = f.rgb, a = f.alpha, et = f.edge;
    for (let p = 0, i = 0; p < PX; p++, i += 3) {
      const al = a[p] / 255, ia = 1 - al;
      dc += Math.abs(rgb[i] - (t[i] * al + bg[0] * ia)) + Math.abs(rgb[i + 1] - (t[i + 1] * al + bg[1] * ia)) + Math.abs(rgb[i + 2] - (t[i + 2] * al + bg[2] * ia));
      de += Math.abs(ec[p] - et[p]);
    }
    return dc / (3 * PX) + TUNE.wEdge * de / PX;
  }
  /* 範囲の自動補正：ユーザーが囲んだ枠は数px ずれるので、自信のあるマスを使って
   * 枠の位置(±6px)とサイズ(±6px)を動かし、照合スコアが最も良くなる枠にスナップする */
  function alignRect(k, feats) {
    const d = ZONE_DEF[k], r0 = C.rects[k]; const cells = [];
    for (let row = 0; row < d.rows; row++) for (let col = 0; col < d.cols; col++) {
      const cf = cellFeature(r0, d, col, row, N); if (cf.fill < 0.03) continue;
      const sc = new Map(); for (const f of feats) { const s = scoreOf(cf, f); const cur = sc.get(f.it); if (cur === undefined || s < cur) sc.set(f.it, s); }
      const top = [...sc.entries()].sort((a, b) => a[1] - b[1]).slice(0, 3); cells.push({ col, row, best: top[0][1], cand: top.map(x => x[0]) });
    }
    if (cells.length < 2) return;
    cells.sort((a, b) => a.best - b.best); const use = cells.slice(0, Math.min(6, cells.length));
    const tf = new Map(); for (const f of feats) { for (const c of use) if (c.cand.includes(f.it)) { if (!tf.has(f.it)) tf.set(f.it, []); tf.get(f.it).push(f); } }
    const cost = r => { let t = 0; for (const c of use) { const cf = cellFeature(r, d, c.col, c.row, N); let b = Infinity; for (const it of c.cand) for (const f of tf.get(it)) b = Math.min(b, scoreOf(cf, f)); t += b; } return t; };
    let best = { r: { ...r0 }, v: cost(r0) }; const base = { ...r0 };
    const STEP = 2, R = 6;
    for (let dy = -R; dy <= R; dy += STEP) for (let dx = -R; dx <= R; dx += STEP) { if (!dx && !dy) continue; const r = { ...base, x: base.x + dx, y: base.y + dy }; const v = cost(r); if (v < best.v) best = { r, v }; }
    const b2 = { ...best.r };
    for (let dh = -R; dh <= R; dh += STEP) for (let dw = -R; dw <= R; dw += STEP) { if (!dw && !dh) continue; const r = { ...b2, w: b2.w + dw, h: b2.h + dh }; const v = cost(r); if (v < best.v) best = { r, v }; }
    const b3 = { ...best.r };   // 微調整 ±1px
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const r = { ...b3, x: b3.x + dx, y: b3.y + dy }; const v = cost(r); if (v < best.v) best = { r, v }; }
    C.rects[k] = best.r; console.log(`[capture] align ${k}: dx=${(best.r.x - r0.x).toFixed(0)} dy=${(best.r.y - r0.y).toFixed(0)} dw=${(best.r.w - r0.w).toFixed(0)} dh=${(best.r.h - r0.h).toFixed(0)}`);
  }
  function matchCell(r, d, col, row, feats) {
    const cf = cellFeature(r, d, col, row, N);
    if (cf.fill < 0.03) return { empty: true };
    // 1段目：全アイテム×全スケールを粗い解像度で照合 → 上位 TUNE.top 件のアイテムを 2段目で高解像度（NF）照合
    const coarse = new Map();
    for (const f of feats) { const s = scoreOf(cf, f); const cur = coarse.get(f.it); if (cur === undefined || s < cur) coarse.set(f.it, s); }
    const cand = [...coarse.entries()].sort((a, b) => a[1] - b[1]).slice(0, TUNE.top).map(x => x[0]);
    // 2段目：範囲指定のわずかなずれに強くするため、マスを ±1px 相当ずらした特徴でも照合して最良を採る
    const step = 1 / N; const cfs = [cf]; for (const dy of [-step, step]) for (const dx of [-step, 0, step]) cfs.push(cellFeature(r, d, col, row, N, dx, dy)); cfs.push(cellFeature(r, d, col, row, N, -step, 0), cellFeature(r, d, col, row, N, step, 0));
    const fine = [];
    for (const it of cand) { let best = Infinity; for (const f of feats) if (f.it === it) for (const c of cfs) best = Math.min(best, scoreOf(c, f)); fine.push({ it, score: best }); }
    fine.sort((a, b) => a.score - b.score);
    const best = fine[0], second = fine[1];
    const margin = Math.min(1, ((second ? second.score : best.score + 10) - best.score) / 6);   // 2位との差が小さいほど自信なし
    const conf = Math.max(0, Math.min(1, (1 - best.score / 60) * 0.6 + margin * 0.4));
    return { it: best.it, score: best.score, conf };
  }

  q("#capRun").addEventListener("click", async () => {
    if (!C.img) return; if (!C.rects.main && !C.rects.belt && !C.rects.wear) { toast("範囲を囲んでください"); return; }
    q("#capMsg").textContent = "アイコンを準備中…"; const feats = await buildFeatures();
    q("#capMsg").textContent = "照合中…"; await new Promise(r => setTimeout(r, 20));
    const out = {}; const t1 = performance.now();
    for (const k in C.rects) {
      if (TUNE.align) { alignRect(k, feats); draw(); }
      const r = C.rects[k], d = ZONE_DEF[k]; const arr = [];
      for (let row = 0; row < d.rows; row++) for (let col = 0; col < d.cols; col++) arr.push(matchCell(r, d, col, row, feats));
      out[k] = arr;
    }
    C.results = out; renderResults(); console.log(`[capture] match in ${Math.round(performance.now() - t1)} ms`);
    const n = Object.values(out).flat().filter(x => x.it).length;
    q("#capMsg").textContent = `${n} 個を認識しました。黄色枠は自信が低い候補です。クリックで修正できます。数量は画像から読み取れないので取り込み後に調整してください`;
  });
  function renderResults() {
    const box = q("#capResults"); box.innerHTML = ""; box.classList.remove("hidden");
    for (const k in C.results) {
      const d = ZONE_DEF[k]; const grid = el("div", { class: "cap-grid", style: `grid-template-columns:repeat(${k === "wear" ? Math.min(d.rows, 8) : d.cols},48px)` });
      C.results[k].forEach((res, i) => {
        const cell = el("div", { class: "cap-cell" + (res.it ? (res.conf < 0.45 ? " low" : "") : " empty"), title: res.it ? `${jname(res.it)}（一致度 ${(res.conf * 100) | 0}%）クリックで変更` : "空き（クリックで指定）" });
        if (res.it) { cell.append(el("img", { src: ico(res.it.s) }), el("span", { class: "cf" }, ((res.conf * 100) | 0) + "%")); }
        cell.addEventListener("click", () => openPicker(it => { C.results[k][i] = { it, conf: 1 }; renderResults(); }));
        cell.addEventListener("contextmenu", e => { e.preventDefault(); C.results[k][i] = { empty: true }; renderResults(); });
        grid.append(cell);
      });
      box.append(el("h4", {}, d.label + "（右クリックで空きに）"), grid);
    }
    q("#capApply").classList.remove("hidden"); q("#capApplyFill").classList.remove("hidden");
  }
  function apply(fillOnly) {
    const m = state.member(); if (!m || !isMine(m)) { toast("取り込み先の参加者を選んでください"); return; }
    let put = 0, skipped = 0;
    for (const k in C.results) {
      const zone = k === "belt" ? "belt" : k === "main" ? "main" : "wear";
      C.results[k].forEach((res, i) => {
        const idx = k === "wear" && C.wearRows === 7 ? i : i; if (idx >= ZONES[zone]) return;
        if (!res.it) { if (!fillOnly) m[zone][idx] = null; return; }
        if (fillOnly && m[zone][idx]) { skipped++; return; }
        const c = canPlace(zone, idx, res.it); if (!c.ok) { skipped++; return; }
        m[zone][idx] = { s: res.it.s, q: defaultQty(res.it) }; put++;
      });
    }
    migratePack(m); state.save(); renderAll(); closeCap();
    toast(`${put} 個を取り込みました` + (skipped ? `（${skipped} 個はスキップ）` : ""));
  }
  q("#capApply").addEventListener("click", () => apply(false));
  q("#capApplyFill").addEventListener("click", () => apply(true));

  /* ---------- 起動ボタン ---------- */
  const btn = el("button", { id: "btnCapture", class: "small editonly", title: "Rust のインベントリ画面のスクリーンショット／画面共有から、持ち物を自動で読み取って取り込む" }, "📷 スクショ取込");
  const head = document.querySelector(".mhead"); head.insertBefore(btn, head.querySelector("#btnDup"));
  btn.addEventListener("click", openCap);
  window.RRP_CAPTURE = { open: openCap, setImage, run: () => q("#capRun").click(), state: C, tune: TUNE, rebuild: () => { C.feats = null; }, setN: (n, nf) => { N = n; if (nf) NF = nf; C.feats = null; } };
})();
