// Plaque Proof Studio launch film. One paused GSAP timeline; Remotion seeks it to each frame,
// so nothing here may depend on wall-clock time.
import gsap from 'gsap';
import { ICONS } from './icons.js';
import { plaque } from './plaque.js';

export const DURATION = 124;

// Builds the film inside the already-mounted stage. `asset` maps a public/ path to its served URL.
// Resolves once fonts and images are loaded and every position has been measured.
export async function createFilm(asset) {
  const Q = (s, r = document) => r.querySelector(s);
  const QA = (s, r = document) => [...r.querySelectorAll(s)];
  const CUES = [];
  const cue = (t, kind, extra = {}) => CUES.push({ t: +t.toFixed(3), kind, ...extra });
  const M = (f) => asset('media/' + f);

  // ---------- static content ----------
  QA('.ic').forEach((el) => {
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[el.dataset.i] || ''}</svg>`;
  });
  const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;

  // Drafting grid
  const grid = Q('#grid');
  let gridHTML = '';
  for (let x = 0; x <= 1920; x += 60) gridHTML += `<line class="${x % 240 === 0 ? 'major' : ''} gv" x1="${x}" y1="0" x2="${x}" y2="1080" stroke-dasharray="1080" stroke-dashoffset="1080"/>`;
  for (let y = 0; y <= 1080; y += 60) gridHTML += `<line class="${y % 240 === 0 ? 'major' : ''} gh" x1="0" y1="${y}" x2="1920" y2="${y}" stroke-dasharray="1920" stroke-dashoffset="1920"/>`;
  grid.innerHTML = gridHTML;

  // Plaques
  // Classic is the real concept the app generated for this order: v1 before the Fix, v2 after it.
  QA('#imgA .lay, #imgB .lay').forEach((el, i) => (el.innerHTML = plaque(i ? 'statement' : 'classic', 'line')));
  Q('#imgA .ren').innerHTML = `<img src="${M('concept-classic-v1.jpg')}" alt="">`;
  Q('#imgA .ren2').innerHTML = `<img src="${M('concept-classic.jpg')}" alt="">`;
  Q('#imgB .ren').innerHTML = plaque('statement', 'metal');
  Q('.p1img').innerHTML = `<img src="${M('concept-classic.jpg')}" alt="">`;
  Q('#eo1 .pw').innerHTML = `<img src="${M('concept-classic.jpg')}" alt="">`;

  // Spec rows
  const swatch = (bg) => `<span class="sw" style="background:${bg}"></span>`;
  const rows = [
    ['Size', '18 × 24 in'],
    ['Material', 'Cast Bronze'],
    ['Plaque finish', 'Natural Satin Brushed Bronze', swatch(`url(${M('natural-satin-brushed-bronze.jpg')}) center/cover`)],
    ['Background color', 'Dark Oxide', swatch('#2b2522')],
    ['Background texture', 'Leatherette', swatch(`url(${M('leatherette.jpg')}) center/cover`)],
    ['Border', 'Single Line Border'],
    ['Font', 'Times New Roman', '', true],
    ['Image option', 'Full Color UV Printed'],
    ['Mounting', 'Blind Mount'],
  ];
  Q('#specRows').innerHTML = rows
    .map(([l, v, sw = '', assumed]) =>
      `<div class="srow"><span class="hl"></span><span class="sl">${l}</span>${assumed ? '<span class="chip amber as">Assumed</span>' : ''}<span class="dots"></span>${sw}<span class="sv">${v}</span></div>`)
    .join('');

  // Wording rows (customer text, unchanged)
  const words = [
    ['Subhead', 'IN HONOR OF', 'b'],
    ['Headline', 'Joyce Conklin-Repp Vankirk', 'b sc'],
    ['Subhead', 'AND', 'b'],
    ['Headline', 'Dallas (Pete) Vankirk', 'b sc'],
    ['Subhead', 'FOUNDERS OF RACCOON RIVER PET RESCUE', 'b'],
    ['Body', 'With vision, generosity, and an unshakable love for animals, you turned compassion into action…', ''],
    ['Body', '“Saving one animal won’t change the world, but it will change the world for that one animal.”', 'i', true],
    ['Footer', '— ANONYMOUS', ''],
  ];
  Q('#wordRows').innerHTML = words
    .map(([r, t, c, tools]) =>
      `<div class="wrow"><div class="mark"></div><div class="role">${r}</div><div class="wt ${c}">${t}</div>${
        tools ? '<div class="tools"><span class="on">I</span><span>B</span><span>Sc</span><span>A−</span><span>A+</span><span>Columns</span><span>Rule</span><span>Font</span></div>' : ''}</div>`)
    .join('');

  // Chaos cards
  const lines = (n, w) => `<div class="lines">${Array.from({ length: n }, (_, i) => `<div style="width:${w[i % w.length]}%"></div>`).join('')}</div>`;
  const chaos = [
    { html: `<div class="cname"><span class="ext">TXT</span>order-32885-spec.txt</div>${lines(5, [100, 92, 70, 96, 55])}`, w: 330, x: 180, y: 140, r: -8 },
    { html: `<div class="cname"><span class="ext">DOCX</span>customer-wording.docx</div>${lines(7, [90, 100, 84, 96, 60, 92, 40])}`, w: 320, x: 1420, y: 120, r: 7 },
    { html: `<div class="cname"><span class="ext">PNG</span>photo.png</div><img src="${M('photo-couple.png')}" style="width:170px">`, w: 210, x: 260, y: 600, r: 6 },
    { html: `<div class="cname"><span class="ext red">PDF</span>proof_v3_FINAL_2.pdf</div><img src="${M('proof-feulner-1.png')}" style="width:300px">`, w: 340, x: 1360, y: 610, r: -6 },
    { html: `“Can the names be bigger?”`, cls: 'note', x: 820, y: 80, r: -4 },
    { html: `<b>RE: RE: RE: Proof changes</b>${lines(3, [100, 80, 60])}`, cls: 'mail', x: 760, y: 780, r: 3 },
    { html: `<div class="cname"><span class="ext">AI</span>production_32885.ai</div><img src="${M('vector-feulner-1.png')}" style="width:150px">`, w: 190, x: 40, y: 330, r: -12 },
    { html: `<div class="cname"><span class="ext red">PDF</span>sketch.pdf</div>${lines(4, [70, 90, 50, 80])}`, w: 260, x: 1640, y: 400, r: 10 },
  ];
  Q('#chaos-cards').innerHTML = chaos
    .map((c) => `<div class="ccard ${c.cls || ''}" style="${c.w ? `width:${c.w}px` : ''}">${c.html}</div>`)
    .join('');

  // Bento
  const tools = [
    ['zoom-in', 'AI Upscaler', 'Enlarge a low-res customer photo to 720p or 1080p without changing it, with a % match score.',
      `<div class="up-viz"><img class="px" src="${M('photo-couple-lowres.png')}"><img src="${M('photo-couple.png')}"><span>98% match</span></div>`],
    ['pen-tool', 'Vectorizer', 'Turn a logo, photo or PDF into a one-ink vector PDF and SVG.',
      `<div style="width:96px;height:128px;background:#fff;border:1.5px solid #d6d8de;border-radius:4px;overflow:hidden"><img src="${M('vector-raccoon-1.png')}" style="width:100%"></div>`],
    ['merge', 'Proof Merger', 'Join up to 15 proofs into one PDF, in the order you choose.',
      `<div class="stack"><i style="left:0;top:0"></i><i style="left:8px;top:8px"></i><i style="left:16px;top:16px;background:#fff url(${M('proof-raccoon-concept.png')}) center/cover"></i></div>`],
    ['spell-check', 'Spell check on every image', 'Each concept is read back and compared with the customer’s wording before it reaches a proof.', ''],
    ['rotate-ccw-clock', 'Nothing is overwritten', 'Every image, fix, proof and production file is its own version. Go back any time.',
      '<div class="vchips"><span>v1</span><span>v2</span><span>v3</span></div>'],
    ['lock', 'Private sign-in', 'Each designer sees only their own jobs, proofs and files.', ''],
  ];
  Q('#bento').innerHTML = tools
    .map(([i, b, p, viz]) => `<div class="bc"><div class="bi">${icon(i)}</div><b>${b}</b><p>${p}</p>${viz ? `<div class="viz">${viz}</div>` : ''}</div>`)
    .join('');

  // Team: one proof before, a stack of them now, per designer
  const sheet = (i) => `<div class="sheet" style="bottom:${i * 42}px;background-image:url(${M('proof-raccoon-concept.png')})"></div>`;
  Q('#team').innerHTML = [1, 2, 3, 4].map((n) => `<div class="tm">
      <div class="col before">${sheet(0)}<div class="lb mono">Before</div></div>
      <div class="col now">${Array.from({ length: 12 }, (_, i) => sheet(i)).join('')}<div class="lb mono">Now</div></div>
      <div class="who"><i class="ic" data-i="user-round"></i>Designer ${n}</div></div>`).join('');
  QA('#team .ic').forEach((el) => { el.innerHTML = icon(el.dataset.i); });

  // Preflight
  const pre = [
    ['Page size', '18 × 24 in'],
    ['Text outlined', '0 fonts'],
    ['Images', '0 images'],
    ['One ink', '#231F20'],
    ['Letters at least ¼″ tall', 'pass'],
  ];
  Q('#pre').insertAdjacentHTML('beforeend', pre
    .map(([a, b]) => `<div class="prow"><span class="pk">${icon('check')}</span>${a}<span class="pv">${b}</span></div>`)
    .join(''));

  // Proof annotations (proof image is 2200 × 1700 px, shown at 1240 wide)
  const k = 1240 / 2200;
  const anns = [
    [150, 40, 1110, 90],
    [1770, 66, 400, 72],
    [1468, 220, 702, 600],
    [1478, 960, 690, 590],
  ];
  Q('#anns').innerHTML = anns
    .map(([x, y, w, h], i) => `<div class="ann" style="left:${x * k}px;top:${y * k}px;width:${w * k}px;height:${h * k}px"><span class="pn">${i + 1}</span></div>`)
    .join('');
  const notes = [
    ['Exact dimensions', 'Width and height, drawn from the order.'],
    ['Order number', 'On every proof, every version.'],
    ['Written from the order', 'The description writes itself. Edit it if you like.'],
    ['Option tiles', 'Finish, background, border and mounting, from your catalog.'],
  ];
  Q('#proofNotes').innerHTML = notes
    .map(([b, s], i) => `<div class="pnote"><span class="pn">${i + 1}</span><div><b>${b}</b><span>${s}</span></div></div>`)
    .join('');

  // Gallery
  const gal = [
    ['bee-murphy', 'canada-college', 'hodges', 'murphys-music', 'faa', 'garden', 'matick', 'schwartz', 'carey-church'],
    ['chicago-fire', 'gamboa', 'september-memorial', 'bowman', 'doug-thomas', 'volpe', 'tree-memorial', 'estess', 'lachance'],
    ['miller', 'doug-payne', 'carey-church', 'hodges', 'canada-college', 'bee-murphy', 'murphys-music', 'faa', 'garden'],
  ];
  Q('#galPlane').innerHTML = gal
    .map((row, i) => `<div class="grow-row" id="gr${i}" style="top:${170 + i * 440}px">${[...row, ...row].map((n) => `<img src="${M(n + '.webp')}">`).join('')}</div>`)
    .join('');

  // Split headline lines into masked words
  QA('.kt .ln').forEach((ln) => {
    const parts = [];
    ln.childNodes.forEach((n) => {
      if (n.nodeType === 3) n.textContent.split(/\s+/).filter(Boolean).forEach((w) => parts.push(`<span class="wm"><span class="wi">${w}</span></span>`));
      else parts.push(`<span class="wm"><span class="wi ${n.className}">${n.textContent}</span></span>`);
    });
    ln.innerHTML = parts.join(' ');
  });

  // ---------- helpers ----------
  const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' } });
  const win = Q('#win');
  const cursor = Q('#cursor');
  const ripple = Q('#ripple');
  const tilt = Q('#winTilt');

  const scene = (id, from, to) => {
    tl.set(`#${id}`, { visibility: 'visible' }, from);
    if (to != null) tl.set(`#${id}`, { visibility: 'hidden' }, to);
  };
  const wordsIn = (sel, at, stagger = 0.06, dur = 0.75) =>
    tl.fromTo(QA(`${sel} .wi`), { yPercent: 115 }, { yPercent: 0, duration: dur, stagger, ease: 'expo.out' }, at);
  const wordsOut = (sel, at, stagger = 0.03, dur = 0.45) =>
    tl.to(QA(`${sel} .wi`), { yPercent: -115, duration: dur, stagger, ease: 'power3.in' }, at);
  const fadeUp = (targets, at, stagger = 0.08, dy = 30, dur = 0.7) =>
    tl.fromTo(targets, { y: dy, opacity: 0 }, { y: 0, opacity: 1, duration: dur, stagger, ease: 'expo.out' }, at);
  const fadeOut = (targets, at, dur = 0.4, dy = -20) => tl.to(targets, { y: dy, opacity: 0, duration: dur, ease: 'power2.in' }, at);

  // Positions in window coordinates (offset chain up to #winTilt; transforms ignored on purpose).
  function pos(el) {
    let x = 0, y = 0, n = el;
    while (n && n !== tilt) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  }
  let camS = 1;
  function cam(at, dur, s, u, v, sx, sy, ease = 'power3.inOut') {
    tl.to(win, { x: sx - u * s, y: sy - v * s, scale: s, duration: dur, ease }, at);
    tl.to([cursor, ripple], { scale: 1.15 / s, duration: dur, ease }, at);
    camS = s;
    cue(at, 'whoosh', { dur });
  }
  const scroll = { L: 0, R: 0 };
  function scrollTo(which, at, dur, y) {
    tl.to(which === 'L' ? '#scrollL' : '#scrollR', { y, duration: dur, ease: 'power3.inOut' }, at);
    scroll[which] = y;
  }
  function click(at, el, { dx = 0, dy = 0, move = 0.6, press = true, side } = {}) {
    const p = pos(el);
    const off = side === 'L' ? scroll.L : side === 'R' ? scroll.R : 0;
    const x = p.x + p.w * 0.5 + dx, y = p.y + p.h * 0.55 + dy + off;
    tl.to(cursor, { x, y, duration: move, ease: 'power2.inOut' }, at - move - 0.04);
    tl.fromTo(ripple, { x, y, scale: 0.2, opacity: 0.9 }, { scale: 1.5 / camS, opacity: 0, duration: 0.55, ease: 'power2.out', immediateRender: false }, at);
    if (press) tl.to(el, { scale: 0.95, duration: 0.08, yoyo: true, repeat: 1, ease: 'power1.inOut' }, at);
    cue(at, 'click');
  }
  function typeText(el, text, at, dur) {
    const o = { n: 0 };
    el.textContent = '';
    tl.to(o, { n: text.length, duration: dur, ease: 'none', onUpdate: () => { el.textContent = text.slice(0, Math.round(o.n)); } }, at);
    cue(at, 'type', { dur });
  }
  function countText(el, from, to, at, dur, fmt) {
    const o = { n: from };
    el.textContent = fmt(from);
    tl.to(o, { n: to, duration: dur, ease: 'power2.out', onUpdate: () => { el.textContent = fmt(Math.round(o.n)); } }, at);
  }
  function blink(el, from, to) {
    tl.set(el, { opacity: 1 }, from);
    const n = Math.floor((to - from) / 0.5);
    for (let i = 0; i < n; i++) tl.set(el, { opacity: i % 2 ? 1 : 0 }, from + 0.5 * (i + 1));
    tl.set(el, { opacity: 0 }, to);
  }
  function step(k, state, at) {
    const st = Q(`.st[data-k="${k}"]`);
    ['todo', 'act', 'done'].forEach((s) => tl.to(Q(`.${s}`, st), { opacity: s === state ? 1 : 0, duration: 0.3 }, at));
  }
  function reveal(el, scanEl, at, dur) {
    tl.fromTo(el, { clipPath: 'inset(0% 0% 100% 0%)', filter: 'blur(5px)' }, { clipPath: 'inset(0% 0% 0% 0%)', filter: 'blur(0px)', duration: dur, ease: 'power2.inOut' }, at);
    tl.fromTo(scanEl, { y: 0, opacity: 1 }, { y: 400, duration: dur, ease: 'power2.inOut' }, at);
    tl.to(scanEl, { opacity: 0, duration: 0.2 }, at + dur - 0.1);
  }

  // Focus dims sit on the window itself and overlap their neighbours by a pixel, so no seam shows
  // where two darkened panels meet at a fractional camera scale.
  const dimGeo = { 'dim-top': [0, 0, 1600, 56], 'dim-L': [0, 56, 400, 844], 'dim-C': [400, 56, 780, 844], 'dim-R': [1180, 56, 420, 844] };
  Object.entries(dimGeo).forEach(([id, [x, y, w, h]]) => {
    const el = Q(`#${id}`);
    tilt.appendChild(el);
    el.style.cssText = `inset:auto;left:${x - 1}px;top:${y - 1}px;width:${w + 2}px;height:${h + 2}px`;
  });

  // ---------- initial states ----------
  gsap.set(win, { x: 240, y: 1100, scale: 0.9 });
  gsap.set(tilt, { rotationX: 30 });
  gsap.set(cursor, { x: 800, y: 500, opacity: 0, scale: 1.15 });
  gsap.set(ripple, { opacity: 0 });
  gsap.set(QA('.cap'), { opacity: 0 });
  gsap.set(QA('.cap > *'), { opacity: 0 });
  gsap.set(QA('.srow, .wrow'), { opacity: 0 });
  gsap.set('#photoRow', { opacity: 0 });
  gsap.set('#cap0', { left: 0, right: 0, top: 46, width: 'auto', textAlign: 'center' });
  gsap.set('#cap0 .ch1', { fontSize: 54 });
  gsap.set('#cap0 .cstep', { justifyContent: 'center', marginBottom: 10 });
  gsap.set(QA('.cimg .ren, .cimg .ren2'), { clipPath: 'inset(0% 0% 100% 0%)' });

  function build() {
    // ===== 1 · Hook (0 – 6) =====
    scene('s-hook', 0, 6.05);
    tl.to(QA('#grid .gv'), { attr: { 'stroke-dashoffset': 0 }, duration: 1.4, stagger: 0.025, ease: 'power2.out' }, 0);
    tl.to(QA('#grid .gh'), { attr: { 'stroke-dashoffset': 0 }, duration: 1.4, stagger: 0.035, ease: 'power2.out' }, 0.2);
    wordsIn('#hook-a', 0.35, 0.08, 0.9);
    cue(0.35, 'whoosh', { dur: 0.6 });
    wordsOut('#hook-a', 2.55);
    ['#hook-b1', '#hook-b2', '#hook-b3'].forEach((s, i) => {
      wordsIn(s, 3 + i, 0.05, 0.55);
      cue(3 + i, 'pop');
      wordsOut(s, 3.82 + i, 0.02, 0.25);
    });

    // ===== 2 · Chaos (6 – 12) =====
    scene('s-chaos', 6, 12.05);
    const cards = QA('.ccard');
    chaos.forEach((c, i) => {
      const el = cards[i];
      const fromX = c.x < 900 ? -500 : 2300;
      tl.fromTo(el, { x: fromX, y: c.y + 120, rotation: c.r * 3, opacity: 1 },
        { x: c.x, y: c.y, rotation: c.r, duration: 0.9, ease: 'expo.out' }, 6 + i * 0.12);
      tl.to(el, { x: c.x + (i % 2 ? 40 : -40), y: c.y + (i % 3 ? 24 : -24), rotation: c.r * 0.6, duration: 2.6, ease: 'sine.inOut' }, 7 + i * 0.12);
      tl.to(el, { x: 960 - (c.w || 300) / 2, y: 480, rotation: 0, scale: 0.15, opacity: 0, duration: 0.55, ease: 'power3.in' }, 9.55 + i * 0.03);
    });
    cue(6, 'whoosh', { dur: 1 });
    wordsIn('#chaos-t', 6.5, 0.06, 0.8);
    wordsOut('#chaos-t', 9.25);
    cue(9.55, 'suck');
    tl.fromTo('#flash', { opacity: 0 }, { opacity: 0.12, duration: 0.08, yoyo: true, repeat: 1 }, 10.1);
    wordsIn('#chaos-n', 10.1, 0.1, 0.8);
    cue(10.1, 'hit');
    tl.to('#chaos-n', { scale: 1.06, duration: 1.7, ease: 'none' }, 10.1);
    tl.to('#chaos-n', { opacity: 0, duration: 0.3 }, 11.7);
    cue(11.0, 'riser', { dur: 1 });

    // ===== 3 · Reveal (12 – 16) =====
    scene('s-reveal', 12, 16.4);
    tl.fromTo('#reveal-disc', { scale: 0 }, { scale: 1, duration: 1.0, ease: 'expo.inOut' }, 11.85);
    cue(12, 'impact');
    tl.fromTo('#reveal-logo', { y: 40, opacity: 0, scale: 0.92 }, { y: 0, opacity: 1, scale: 1, duration: 1, ease: 'expo.out' }, 12.45);
    tl.fromTo(QA('#reveal-name span'), { y: 70, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, stagger: 0.1, ease: 'expo.out' }, 12.8);
    tl.fromTo('#reveal-rule', { scaleX: 0 }, { scaleX: 1, duration: 0.9, ease: 'expo.inOut' }, 13.3);
    fadeUp('#reveal-tag', 13.7);
    fadeOut('#reveal-box', 15.4, 0.5, -60);
    tl.to('#reveal-disc', { scale: 0, duration: 0.9, ease: 'expo.inOut' }, 15.55);

    // ===== 4 · App walkthrough (16 – 59.6) =====
    scene('s-app', 15.6, 59.7);
    step('order', 'act', 15.6);
    tl.to(win, { x: 160, y: 150, scale: 1, duration: 1.3, ease: 'expo.out' }, 15.8);
    tl.to(tilt, { rotationX: 0, duration: 1.5, ease: 'expo.out' }, 15.8);
    cue(15.8, 'whoosh', { dur: 1 });
    tl.set('#cap0', { opacity: 1 }, 16.3);
    fadeUp(QA('#cap0 > *'), 16.3, 0.1, 20);
    fadeOut(QA('#cap0 > *'), 18.2, 0.35);

    // --- F1 · read the order (18.4 – 28)
    const capIn = (id, at) => { tl.set(id, { opacity: 1 }, at); fadeUp(QA(`${id} > *`), at, 0.12, 36, 0.85); };
    const capOut = (id, at) => { fadeOut(QA(`${id} > *`), at, 0.4); tl.set(id, { opacity: 0 }, at + 0.45); };
    cam(18.3, 1.2, 1.7, 0, 74, 90, 64);
    tl.to(['#dim-C', '#dim-R', '#dim-top'], { opacity: 1, duration: 0.8 }, 18.4);
    capIn('#cap1', 19.0);
    tl.to(cursor, { opacity: 1, duration: 0.3 }, 19.2);
    const ta = Q('#specTa');
    click(19.75, ta, { move: 0.5, press: false, dy: -40 });
    const spec = 'DESCRIPTION: Qty. 1 set 18”x24” 1/4” thick Satin Brushed Bronze Plaque. Single line border.\nBackground painted Dark Oxide with Leatherette texture.\nCopy: as per customer art file. Includes Full Color UV printed photo. Blind Stud Mount with pattern.';
    blink(Q('#specCaret'), 19.8, 22.3);
    typeText(Q('#specTxt'), spec, 19.95, 2.1);
    click(22.75, Q('#btnRead'), { move: 0.5 });
    const srows = QA('.srow');
    const rowsBottom = pos(Q('#specRows')).y + Q('#specRows').offsetHeight;
    tl.to(win, { y: 1035 - rowsBottom * 1.7, duration: 1.6, ease: 'power2.inOut' }, 23.0);
    tl.to(cursor, { opacity: 0, duration: 0.3 }, 23.2);
    srows.forEach((r, i) => {
      const at = 23.1 + i * 0.15;
      tl.fromTo(r, { opacity: 0, x: -14 }, { opacity: 1, x: 0, duration: 0.5, ease: 'expo.out' }, at);
      tl.fromTo(Q('.hl', r), { opacity: 0 }, { opacity: 1, duration: 0.15, yoyo: true, repeat: 1, ease: 'none' }, at);
      cue(at, 'tick');
    });
    tl.fromTo('.srow .as', { scale: 1.6 }, { scale: 1, duration: 0.5, ease: 'back.out(3)' }, 23.1 + 6 * 0.15);
    tl.fromTo('#assumedCount', { scale: 1 }, { scale: 1.2, duration: 0.18, yoyo: true, repeat: 1 }, 24.4);
    capOut('#cap1', 27.3);

    // --- F2 · wording (27.8 – 32.4), files (32.4 – 35.6)
    const sec2 = Q('#sec2');
    scrollTo('L', 27.7, 1.0, -(sec2.offsetTop));
    tl.to(win, { y: 64 - 56 * 1.7, duration: 1.0, ease: 'power3.inOut' }, 27.7);
    capIn('#cap2', 28.2);
    tl.to(cursor, { opacity: 1, duration: 0.3 }, 28.2);
    click(28.95, Q('#btnDocx'), { side: 'L' });
    QA('.wrow').forEach((r, i) => {
      tl.fromTo(r, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.45, ease: 'expo.out' }, 29.25 + i * 0.12);
      cue(29.25 + i * 0.12, 'tick', { soft: true });
    });
    tl.to(cursor, { opacity: 0, duration: 0.3 }, 29.4);
    const qrow = QA('.wrow')[6];
    tl.to(Q('.mark', qrow), { opacity: 1, duration: 0.3 }, 30.6);
    tl.fromTo(QA('#cap2 .gl'), { y: 30, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1, duration: 0.6, stagger: 0.15, ease: 'back.out(2)', immediateRender: false }, 30.8);
    QA('#cap2 .gl').forEach((g, i) => cue(30.8 + i * 0.15, 'pop'));
    tl.to(Q('.mark', qrow), { opacity: 0, duration: 0.3 }, 32.2);
    capOut('#cap2', 32.2);

    const sec3 = Q('#sec3');
    scrollTo('L', 32.4, 1.0, -(sec3.offsetTop));
    capIn('#cap2b', 32.8);
    tl.to(cursor, { opacity: 1, duration: 0.3 }, 32.9);
    click(33.65, Q('#fPhotos .add'), { side: 'L' });
    tl.fromTo('#photoRow', { opacity: 0, y: -16, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'back.out(2)' }, 33.95);
    cue(33.95, 'pop');
    tl.to(cursor, { opacity: 0, duration: 0.3 }, 34.3);
    capOut('#cap2b', 35.3);
    step('order', 'done', 35.7);
    step('concepts', 'act', 35.7);

    // --- F3 · concepts (35.7 – 45.6)
    const pC = Q('#pC');
    cam(35.6, 1.2, 1.28, 400, 56, 50, 0);
    tl.to('#dim-L', { opacity: 1, duration: 0.8 }, 35.7);
    tl.to('#dim-C', { opacity: 0, duration: 0.8 }, 35.7);
    capIn('#cap3', 36.5);
    tl.to(cursor, { opacity: 1, duration: 0.3 }, 36.6);
    click(37.45, Q('#btnGen'));
    tl.fromTo('#cbar', { scaleX: 0, opacity: 1 }, { scaleX: 1, duration: 3.2, ease: 'power1.inOut' }, 37.55);
    tl.to('#cbar', { opacity: 0, duration: 0.3 }, 40.8);
    tl.to(cursor, { opacity: 0, duration: 0.3 }, 37.9);
    reveal(Q('#imgA .ren'), Q('#imgA .scan'), 38.2, 1.8);
    reveal(Q('#imgB .ren'), Q('#imgB .scan'), 38.7, 1.8);
    cue(38.2, 'render', { dur: 2.3 });
    tl.to(QA('.cimg .tag'), { opacity: 0, duration: 0.3, stagger: 0.5 }, 38.4);
    fadeUp(['#vA1', '#vB1'], 40.7, 0.1, 8, 0.5);
    fadeUp(['#spellA', '#spellB'], 41.0, 0.12, 8, 0.5);
    cue(41.0, 'ding');
    fadeUp(['#guidedA', '#guidedB'], 41.35, 0.12, 8, 0.5);
    // slow push-in while the concepts sit on screen
    tl.to(win, { x: 50 - 400 * 1.32, y: -56 * 1.32 - 10, scale: 1.32, duration: 3.6, ease: 'sine.inOut' }, 41.7);
    capOut('#cap3', 45.3);

    // --- F4 · fix (45.6 – 53.6)
    const cardA = Q('#cardA');
    const pa = pos(cardA);
    const sF = 1.55;
    cam(45.6, 1.2, sF, pa.x, pa.y + 40, 120, 0);
    camS = sF;
    // Everything but the Classic card goes dark while it is being fixed.
    tl.set('#cardA', { zIndex: 21 }, 45.6);
    tl.to('#dim-C', { opacity: 1, duration: 0.6 }, 45.8);
    tl.to('#cardB', { opacity: 0, duration: 0.6 }, 45.8);
    capIn('#cap4', 46.4);
    tl.to(cursor, { opacity: 1, duration: 0.3 }, 46.5);
    click(47.1, Q('#fixTa'), { press: false });
    tl.to('#fixPh', { opacity: 0, duration: 0.15 }, 47.2);
    blink(Q('#fixCaret'), 47.2, 49.2);
    typeText(Q('#fixTxt'), 'Add a raised paw print on each side of the photo', 47.3, 1.7);
    click(49.4, Q('#btnApply'));
    tl.fromTo('#plan', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, ease: 'expo.out' }, 49.65);
    fadeUp(['#pc1', '#pc2'], 49.95, 0.3, 8, 0.45);
    cue(49.95, 'pop'); cue(50.25, 'pop');
    tl.to(cursor, { opacity: 0, duration: 0.3 }, 50.0);
    tl.to('#plan', { opacity: 0, y: 10, duration: 0.35, ease: 'power2.in' }, 51.3);
    reveal(Q('#imgA .ren2'), Q('#imgA .scan'), 51.4, 1.4);
    cue(51.4, 'render', { dur: 1.4 });
    fadeUp('#vA2', 52.9, 0, 8, 0.5);
    tl.fromTo('#spellA', { opacity: 0.2 }, { opacity: 1, duration: 0.4 }, 52.9);
    cue(52.9, 'ding');
    capOut('#cap4', 53.4);

    // --- F5 · on the proof (53.6 – 59.6)
    tl.to(cursor, { opacity: 1, duration: 0.3 }, 53.4);
    click(54.2, Q('#useA'));
    tl.to(QA('#useA .u2'), { opacity: 1, duration: 0.25 }, 54.25);
    tl.to('#onProof', { opacity: 1, duration: 0.25 }, 54.3);
    tl.fromTo('#tickA', { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(3)' }, 54.3);
    cue(54.3, 'ding');
    step('concepts', 'done', 54.4);
    step('proof', 'act', 54.4);
    const sR = 1.45;
    cam(54.8, 1.1, sR, 1180, 56, 1090, 0);
    tl.to('#cardB', { opacity: 1, duration: 0.1 }, 55.9);
    tl.set('#cardA', { zIndex: 0 }, 55.9);
    tl.to('#dim-C', { opacity: 1, duration: 0.6 }, 54.9);
    tl.to('#dim-R', { opacity: 0, duration: 0.6 }, 54.9);
    tl.to(cursor, { opacity: 0, duration: 0.2 }, 54.8);
    tl.to('#emptyProof', { opacity: 0, duration: 0.25 }, 55.6);
    tl.fromTo('#page1', { opacity: 0, y: -14 }, { opacity: 1, y: 0, duration: 0.6, ease: 'back.out(2)' }, 55.7);
    cue(55.7, 'pop');
    capIn('#cap5', 55.6);
    tl.to(cursor, { opacity: 1, duration: 0.3 }, 56.0);
    click(56.75, Q('#btnProof'), { side: 'R' });
    tl.to('#proofFile', { height: 'auto', opacity: 1, paddingTop: 12, paddingBottom: 12, duration: 0.7, ease: 'expo.out' }, 57.0);
    cue(57.0, 'pop');
    tl.to(cursor, { opacity: 0, duration: 0.3 }, 57.2);
    // Dive into the proof thumbnail, then hand over to the full-size proof
    const pf = Q('#proofFile');
    const savedH = pf.style.height;
    gsap.set(pf, { height: 'auto', paddingTop: 12, paddingBottom: 12 });
    const th = pos(Q('#proofFile .fthumb img'));
    gsap.set(pf, { height: 0, paddingTop: 0, paddingBottom: 0 });
    pf.style.height = savedH || '0px';
    capOut('#cap5', 58.0);
    const sP = 1240 / th.w;
    tl.to(win, { x: 70 - th.x * sP, y: 60 - th.y * sP, scale: sP, duration: 1.2, ease: 'expo.inOut' }, 58.2);
    tl.to('#dim-top', { opacity: 0, duration: 0.3 }, 58.2);
    cue(58.2, 'whoosh', { dur: 1.2 });

    // ===== 5 · Proof (59.3 – 66) =====
    scene('s-proof', 59.3, 66.1);
    tl.fromTo('#proofBig', { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'none' }, 59.3);
    step('proof', 'done', 59.3);
    tl.to('#proofBig', { scale: 0.97, duration: 6, ease: 'sine.inOut' }, 59.6);
    fadeUp(QA('#capProof > *'), 59.7, 0.1);
    tl.set('#capProof', { opacity: 1 }, 59.7);
    QA('.ann').forEach((a, i) => {
      const at = 60.4 + i * 0.55;
      tl.fromTo(a, { opacity: 0, scale: 1.08 }, { opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(2)' }, at);
      tl.fromTo(QA('.pnote')[i], { opacity: 0, x: 30 }, { opacity: 1, x: 0, duration: 0.6, ease: 'expo.out' }, at + 0.05);
      cue(at, 'pop');
    });
    tl.to(['#proofBig', '#proofNotes', '#capProof'], { opacity: 0, y: -30, duration: 0.45, ease: 'power2.in' }, 65.6);

    // ===== 6 · Vector (66 – 72.6) =====
    scene('s-vector', 66.0, 72.7);
    tl.fromTo('#vecBox', { opacity: 0, y: 60, rotationY: 12 }, { opacity: 1, y: 0, rotationY: 0, duration: 1, ease: 'expo.out', transformPerspective: 1600 }, 66.0);
    cue(66, 'whoosh', { dur: 0.8 });
    fadeUp(QA('#vecText > *'), 66.3, 0.12);
    // Concept turns over to reveal the one-ink production file
    tl.fromTo('#vecTag', { opacity: 0 }, { opacity: 1, duration: 0.4 }, 66.4);
    tl.set('#vt2', { opacity: 0 }, 66.0);
    tl.set('#vecBclip', { opacity: 0 }, 66.0);
    tl.to('#vecBox', { rotationY: 90, duration: 0.45, ease: 'power2.in', transformPerspective: 1600 }, 67.3);
    tl.set('#vecBclip', { opacity: 1 }, 67.75);
    tl.set('#vecA', { opacity: 0 }, 67.75);
    tl.fromTo('#vecBox', { rotationY: -90 }, { rotationY: 0, duration: 0.6, ease: 'power3.out', transformPerspective: 1600, immediateRender: false }, 67.75);
    tl.to('#vt1', { opacity: 0, duration: 0.2 }, 67.3);
    tl.to('#vt2', { opacity: 1, duration: 0.3 }, 67.8);
    cue(67.3, 'swipe');
    QA('.prow').forEach((r, i) => {
      tl.fromTo(r, { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.5, ease: 'expo.out' }, 67.6 + i * 0.32);
      tl.fromTo(Q('.pk', r), { scale: 0 }, { scale: 1, duration: 0.45, ease: 'back.out(3)' }, 67.7 + i * 0.32);
      cue(67.7 + i * 0.32, 'tick');
    });
    step('vector', 'done', 68);
    tl.to(['#vecBox', '#vecText', '#vecTag'], { opacity: 0, y: -30, duration: 0.45, ease: 'power2.in', stagger: 0.05 }, 72.1);

    // ===== 7 · One engine (72.6 – 78) =====
    scene('s-engine', 72.6, 78.1);
    wordsIn('#eng-h', 72.7, 0.06, 0.8);
    cue(72.7, 'whoosh', { dur: 0.6 });
    tl.fromTo('#eng-core', { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.7, ease: 'back.out(2)' }, 73.4);
    cue(73.4, 'hit', { soft: true });
    const svg = Q('#eng-lines');
    const outs = ['#eo1', '#eo2', '#eo3'];
    svg.innerHTML = outs.map((s) => {
      const el = Q(s);
      const ex = el.offsetLeft + 210, ey = 590;
      return `<path d="M960 470 C 960 540, ${ex} 520, ${ex} ${ey}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>`;
    }).join('');
    tl.to(QA('#eng-lines path'), { attr: { 'stroke-dashoffset': 0 }, duration: 0.8, stagger: 0.12, ease: 'power2.inOut' }, 73.9);
    outs.forEach((s, i) => {
      tl.fromTo(s, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.8, ease: 'expo.out' }, 74.4 + i * 0.18);
      cue(74.4 + i * 0.18, 'pop');
    });
    tl.to(['#eng-h', '#eng-core', '#eng-lines', ...outs], { opacity: 0, duration: 0.45, ease: 'power2.in' }, 77.6);

    // ===== 8 · Toolkit (78 – 84) =====
    scene('s-tools', 78, 84.1);
    wordsIn('#tools-h', 78.05, 0.06, 0.8);
    cue(78.05, 'whoosh', { dur: 0.6 });
    QA('.bc').forEach((c, i) => {
      tl.fromTo(c, { opacity: 0, y: 70, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.8, ease: 'expo.out' }, 78.5 + i * 0.13);
      cue(78.5 + i * 0.13, 'tick', { soft: true });
    });
    tl.to('#bento', { y: -14, duration: 5, ease: 'none' }, 78.5);
    tl.to(['#tools-h', '#bento'], { opacity: 0, y: -40, duration: 0.45, ease: 'power2.in' }, 83.6);

    // ===== 9 · Benefits (84 – 88) =====
    scene('s-ben', 84, 88.1);
    [['#ben1', 84.0], ['#ben2', 85.2], ['#ben3', 86.4]].forEach(([s, at], i) => {
      wordsIn(s, at, 0.07, 0.6);
      cue(at, 'hit', { soft: i < 2 });
      wordsOut(s, at + 1.0, 0.03, 0.3);
    });

    // ===== 9b · Time saved (88 – 96) =====
    scene('s-time', 87.9, 96.1);
    wordsIn('#time-h1', 88.0, 0.06, 0.8);
    cue(88.0, 'whoosh', { dur: 0.8 });
    QA('.day').forEach((d, i) => {
      tl.fromTo(d, { opacity: 0, y: 60, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: 'expo.out' }, 88.5 + i * 0.22);
      cue(88.5 + i * 0.22, 'pop');
    });
    tl.fromTo('#daysBar', { opacity: 0, scaleX: 0.2 }, { opacity: 1, scaleX: 1, duration: 0.8, ease: 'expo.out' }, 89.5);
    // Four days collapse into a stopwatch
    wordsOut('#time-h1', 91.3);
    QA('.day').forEach((d, i) => {
      tl.to(d, { x: (1.5 - i) * 398, scaleX: 0.08, scaleY: 0.5, opacity: 0, duration: 0.6, ease: 'power3.in' }, 91.4 + Math.abs(1.5 - i) * 0.04);
    });
    tl.to('#daysBar', { scaleX: 0.02, opacity: 0, duration: 0.6, ease: 'power3.in' }, 91.4);
    cue(91.4, 'suck');
    tl.fromTo('#watch', { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.8, ease: 'back.out(1.6)' }, 92.0);
    cue(92.0, 'hit', { soft: true });
    tl.fromTo('#watchArc', { attr: { 'stroke-dashoffset': 1 } }, { attr: { 'stroke-dashoffset': 0 }, duration: 1.8, ease: 'power2.out' }, 92.2);
    countText(Q('#watchT'), 0, 208, 92.2, 1.8, (n) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`);
    cue(92.2, 'type', { dur: 1.6 });
    wordsIn('#time-h2', 92.6, 0.06, 0.8);
    cue(94.0, 'ding');
    tl.to(['#watch', '#time-h2'], { opacity: 0, y: -30, duration: 0.45, ease: 'power2.in' }, 95.6);

    // ===== 9c · Cost and time per proof (96 – 101.5) =====
    scene('s-stats', 96.0, 101.6);
    wordsIn('#stats-h', 96.05, 0.06, 0.8);
    cue(96.05, 'whoosh', { dur: 0.6 });
    QA('.kpi').forEach((k, i) => {
      tl.fromTo(k, { opacity: 0, y: 70 }, { opacity: 1, y: 0, duration: 0.8, ease: 'expo.out' }, 96.5 + i * 0.18);
      cue(96.5 + i * 0.18, 'pop');
    });
    countText(Q('#kCents'), 0, 10, 96.9, 1.0, (n) => String(n));
    tl.fromTo('#kDays', { '--strike': 0 }, { '--strike': 1, duration: 0.5, ease: 'power2.inOut' }, 97.7);
    cue(97.7, 'swipe');
    tl.fromTo('#kMin', { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.5, ease: 'expo.out' }, 98.1);
    tl.to(['#stats-h', '#kpis'], { opacity: 0, y: -30, duration: 0.45, ease: 'power2.in' }, 101.1);

    // ===== 9d · Every designer (101.5 – 106.5) =====
    scene('s-team', 101.5, 106.6);
    wordsIn('#team-h', 101.55, 0.05, 0.8);
    cue(101.55, 'whoosh', { dur: 0.6 });
    fadeUp('#team-p', 101.9, 0, 20);
    QA('.tm').forEach((t, i) => {
      const at = 102.2 + i * 0.12;
      tl.fromTo(Q('.who', t), { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.5, ease: 'expo.out' }, at);
      tl.fromTo(QA('.lb', t), { opacity: 0 }, { opacity: 1, duration: 0.4 }, at + 0.2);
      tl.fromTo(Q('.before .sheet', t), { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4, ease: 'back.out(2)' }, at + 0.3);
      tl.fromTo(QA('.now .sheet', t), { opacity: 0, y: -40, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.35, stagger: 0.07, ease: 'back.out(2)' }, at + 0.6);
    });
    for (let k = 0; k < 12; k++) cue(102.8 + k * 0.1, 'tick', { soft: true });
    tl.to(['#team-h', '#team-p', '#team'], { opacity: 0, y: -30, duration: 0.45, ease: 'power2.in' }, 106.1);

    // ===== 9e · The everyday 85% (106.5 – 112) =====
    scene('s-share', 106.5, 112.1);
    tl.fromTo('#donut', { opacity: 0, scale: 0.85, rotation: -20 }, { opacity: 1, scale: 1, rotation: 0, duration: 0.9, ease: 'expo.out' }, 106.55);
    cue(106.55, 'whoosh', { dur: 0.6 });
    tl.fromTo('#arc85', { attr: { 'stroke-dashoffset': 85 } }, { attr: { 'stroke-dashoffset': 0 }, duration: 1.5, ease: 'power2.inOut' }, 106.9);
    countText(Q('#pctN'), 0, 85, 106.9, 1.5, (n) => String(n));
    cue(106.9, 'render', { dur: 1.5 });
    tl.fromTo('#arc15', { opacity: 0 }, { opacity: 1, duration: 0.5 }, 108.4);
    cue(108.4, 'ding');
    fadeUp(QA('#share-t > *'), 107.2, 0.14);
    tl.to(['#donut', '#share-t'], { opacity: 0, y: -30, duration: 0.45, ease: 'power2.in' }, 111.5);

    // ===== 10 · Gallery (112 – 118) =====
    scene('s-gal', 111.9, 118.2);
    tl.fromTo('#galWrap', { opacity: 0, scale: 1.12 }, { opacity: 1, scale: 1, duration: 1.4, ease: 'expo.out' }, 111.9);
    tl.fromTo('#gr0', { x: 0 }, { x: -900, duration: 6.4, ease: 'none' }, 111.9);
    tl.fromTo('#gr1', { x: -1100 }, { x: -200, duration: 6.4, ease: 'none' }, 111.9);
    tl.fromTo('#gr2', { x: -300 }, { x: -1200, duration: 6.4, ease: 'none' }, 111.9);
    cue(112, 'whoosh', { dur: 1.2 });
    wordsIn('#gal-t', 112.7, 0.07, 0.9);
    wordsOut('#gal-t', 117.2);
    tl.to('#galWrap', { opacity: 0, duration: 0.5 }, 117.7);

    // ===== 11 · End (118 – 124) =====
    scene('s-end', 118, null);
    tl.to('#bg-paper', { opacity: 1, duration: 0.6, ease: 'power2.inOut' }, 117.9);
    tl.fromTo('#endLogo', { y: 40, opacity: 0, scale: 0.94 }, { y: 0, opacity: 1, scale: 1, duration: 1, ease: 'expo.out' }, 118.3);
    cue(118.3, 'impact', { soft: true });
    tl.fromTo('#endName', { y: 50, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9, ease: 'expo.out' }, 118.6);
    tl.fromTo('#endRule', { scaleX: 0 }, { scaleX: 1, duration: 0.9, ease: 'expo.inOut' }, 119.0);
    fadeUp('#endTag', 119.3);
    fadeUp('#endUrl', 119.7);
    tl.set({}, {}, DURATION);
  }

  // The caption for customer files is built here to keep index.html readable.
  Q('#cap2').insertAdjacentHTML('afterend', `<div class="cap right" id="cap2b">
      <div class="cstep mono"><b>03</b> Customer files</div>
      <div class="ch1">Photos, logos and sketches.</div>
      <div class="cp">Up to 4 photos and 6 logos, placed for you. Sketches guide the design but never print on the plaque. Or drop in the complete approved artwork.</div>
    </div>`);
  gsap.set(['#cap2b', '#cap2b > *'], { opacity: 0 });
  // Renumber the later captions: 01 order, 02 wording, 03 files, 04 concepts, 05 fix, 06 proof, 07 production.
  Q('#cap3 .cstep b').textContent = '04';
  Q('#cap4 .cstep b').textContent = '05';
  Q('#cap5 .cstep b').textContent = '06';
  Q('#capProof .cstep b').textContent = '06';
  Q('#vecText .cstep b').textContent = '07';

  QA('img').forEach((im) => {
    const src = im.getAttribute('src');
    if (src && src.startsWith('media/')) im.src = asset(src);
  });
  const imgs = QA('img').map((im) => (im.complete && im.naturalWidth ? Promise.resolve() : new Promise((r) => { im.onload = im.onerror = r; })));
  await Promise.all([...[...document.fonts].map((f) => f.load()), ...imgs]);
  await document.fonts.ready;
  build();
  return { tl, cues: CUES.sort((a, b) => a.t - b.t) };
}
