// One paid visual edit of a verification concept; no automatic spelling override.
// PW=test CONCEPT_ID=<id> OUT=<new artifact folder> node scripts/verify-fix.mjs
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const base = process.env.BASE || 'http://localhost:8080';
const conceptId = process.env.CONCEPT_ID;
if (!conceptId) throw new Error('Set CONCEPT_ID to the verification image to edit.');
const out = process.env.OUT || `output/live/fix-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.mkdirSync(out, { recursive: true });
const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Live fix verification', password: process.env.PW || 'test' }) });
if (!login.ok) throw new Error('Sign-in failed.');
const cookie = login.headers.get('set-cookie')?.split(';')[0];
async function request(url, body) {
  return fetch(`${base}/api${url}`, { method: body ? 'POST' : 'GET', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
}
const response = await request(`/concepts/${conceptId}/fix`, { instruction: process.env.INSTRUCTION || 'correct the spelling in this image', quality: 'high' });
if (!response.ok) throw new Error(`Edit rejected: ${response.status} ${await response.text()}`);
const events = (await response.text()).split('\n\n').filter((s) => s.startsWith('data: ')).map((s) => JSON.parse(s.slice(6)));
const concept = events.filter((e) => e.type === 'concept').at(-1)?.concept;
if (!concept || concept.status !== 'done') throw new Error(concept?.error || 'Edit did not finish.');
const results = { plan: events[0].plan, concept, outputs: [] };
const savePreview = async (url, name) => {
  const res = await request(url);
  if (!res.ok) throw new Error('Preview failed.');
  await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toFile(path.join(out, name));
};
await savePreview(`/concepts/${concept.id}/image.png`, 'concept.jpg');
if (concept.spellcheck?.checked && concept.spellcheck.ok) {
  for (const kind of ['proof', 'production']) {
    const res = await request(`/projects/${concept.projectId}/${kind}`, { conceptId: concept.id });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error);
    const download = await request(`/outputs/${payload.output.id}/download`);
    fs.writeFileSync(path.join(out, `${kind}.pdf`), Buffer.from(await download.arrayBuffer()));
    await savePreview(`/outputs/${payload.output.id}/preview.png`, `${kind}.jpg`);
    results.outputs.push(payload.output);
  }
}
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ output: out, plan: results.plan, status: concept.status, spellcheck: concept.spellcheck, seconds: concept.durationMs / 1000, costUsd: concept.costUsd, outputs: results.outputs.length }));
