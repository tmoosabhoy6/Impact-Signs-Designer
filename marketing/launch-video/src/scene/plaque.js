// The Raccoon River plaque (job 32885) drawn in HTML: the layout drawing for both concepts and the
// Statement concept. The Classic concept is the real image the app generated (media/concept-classic.jpg);
// these proportions follow it. Wording is the customer's, character for character
// (references/32885-raccoon-river/wording.json).
const W = {
  honor: 'IN HONOR OF',
  joyce: 'Joyce Conklin-Repp Vankirk',
  and: 'AND',
  dallas: 'Dallas (Pete) Vankirk',
  founders: 'FOUNDERS OF RACCOON RIVER PET RESCUE',
  body: [
    'With vision, generosity, and an unshakable love for animals, you turned compassion into action and a dream into reality.',
    'Your compassion, vision, and dedication created a safe haven for countless animals in need. Because of your love, so many now know the joy of a forever home.',
    'Raccoon River Pet Rescue stands today as a testament to your kindness and the lives forever changed by it.',
  ],
  quote: '“Saving one animal won’t change the world,<br>but it will change the world for that one animal.”',
  footer: '— ANONYMOUS',
};
const photo = '<div class="ph"><img src="media/photo-couple.png" alt=""></div>';
const bodyBlock = () =>
  `<div class="bw"><div class="body">${W.body.map((p) => `<div class="m">${p}</div>`).join('')}<div class="m q">${W.quote}</div></div></div>` +
  `<div class="ft m">${W.footer}</div>`;

function classic() {
  return `<div class="tx" style="padding-top:5.2em">
    <div class="sub m">${W.honor}</div><div class="hl m">${W.joyce}</div>
    <div class="sub m">${W.and}</div><div class="hl m">${W.dallas}</div>
    ${photo}
    <div class="sub2 m">${W.founders}</div>
    ${bodyBlock()}
  </div>`;
}
function statement() {
  return `<div class="tx" style="padding-top:6.5em">
    <div class="cols"><div>${photo}</div>
      <div><div class="sub m">${W.honor}</div><div class="hl m">${W.joyce}</div><div class="sub m">${W.and}</div></div></div>
    <div class="hl m" style="margin-top:2.2em">${W.dallas}</div>
    <div class="sub2 m" style="margin-top:.6em">${W.founders}</div>
    ${bodyBlock()}
  </div>`;
}

// variant: classic | statement; mode: metal | line (the flat layout drawing)
export function plaque(variant, mode) {
  const inner = variant === 'statement' ? statement() : classic();
  const cls = ['pl', variant, mode === 'line' ? 'line' : ''].join(' ');
  return `<div class="${cls}"><div class="rim"></div><div class="field"><div class="tex"></div></div>${inner}</div>`;
}
