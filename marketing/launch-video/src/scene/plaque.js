// The Raccoon River plaque (job 32885), drawn in HTML so it stays sharp at any zoom.
// Wording is the customer's, character for character (references/32885-raccoon-river/wording.json).
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
  `<div class="bw"><div class="body m">${W.body.map((p) => `<div>${p}</div>`).join('')}<div class="q">${W.quote}</div></div></div>` +
  `<div class="ft m">${W.footer}</div>`;

function classic() {
  return `<div class="tx" style="padding-top:7.4em">
    <div class="sub m">${W.honor}</div><div class="hl m">${W.joyce}</div>
    <div class="sub m">${W.and}</div><div class="hl m">${W.dallas}</div>
    ${photo}
    <div class="sub2 m" style="margin-top:4em">${W.founders}</div>
    ${bodyBlock()}
  </div>`;
}
function statement() {
  return `<div class="tx" style="padding-top:8em">
    <div class="cols"><div>${photo}</div>
      <div><div class="sub m">${W.honor}</div><div class="hl m">${W.joyce}</div><div class="sub m">${W.and}</div></div></div>
    <div class="hl m" style="margin-top:3.6em">${W.dallas}</div>
    <div class="sub2 m" style="margin-top:.5em">${W.founders}</div>
    ${bodyBlock()}
  </div>`;
}

// variant: classic | statement | classic2 (after the Fix); mode: metal | line
export function plaque(variant, mode) {
  const inner = variant === 'statement' ? statement() : classic();
  const cls = ['pl', mode === 'line' ? 'line' : '', variant === 'classic2' ? 'v2' : ''].join(' ');
  const dl = variant === 'classic2' ? '<div class="dl"></div>' : '';
  return `<div class="${cls}"><div class="rim"></div><div class="field"><div class="tex"></div>${dl}</div>${inner}</div>`;
}
