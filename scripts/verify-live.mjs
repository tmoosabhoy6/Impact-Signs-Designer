// Uses the running app, never the OpenAI key. Creates new example jobs and
// retains its artifacts; run explicitly because live mode incurs API charges.
// BASE=http://localhost:8080 PW=test node scripts/verify-live.mjs
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const base = process.env.BASE || 'http://localhost:8080';
const out = process.env.OUT || `output/live/${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.mkdirSync(out, { recursive: true });
const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Live verification', password: process.env.PW || 'test' }) });
if (!login.ok) throw new Error('Sign-in failed. Set PW to the app password.');
const cookie = login.headers.get('set-cookie')?.split(';')[0];
async function request(url, body) {
  return fetch(`${base}/api${url}`, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function json(url, body) {
  const res = await request(url, body);
  const data = await res.json();
  if (!res.ok) throw new Error(`${url}: ${data.error || res.status}`);
  return data;
}
async function jpeg(url, file) {
  const res = await request(url);
  if (!res.ok) throw new Error(`Preview failed: ${res.status}`);
  await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toFile(path.join(out, file));
}
const health = await json('/health/details?live=1');
const { examples } = await json('/examples');
const results = { date: new Date().toISOString(), health, missingExamples: [], jobs: [] };
for (const id of ['32241-edwin-feulner', '32885-raccoon-river', '32249-structure-of-merit']) {
  if (!examples.some((ex) => ex.id === id)) { results.missingExamples.push(id); continue; }
  const { project } = await json(`/examples/${id}`, {});
  const response = await request(`/projects/${project.id}/generate`, { quality: 'high' });
  if (!response.ok) throw new Error(`Generation rejected: ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let partials = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separator;
    while ((separator = buffer.indexOf('\n\n')) >= 0) {
      const event = buffer.slice(0, separator); buffer = buffer.slice(separator + 2);
      if (!event.startsWith('data: ')) continue;
      const data = JSON.parse(event.slice(6));
      if (data.type === 'partial') partials++;
      if (data.type === 'concept' && ['done', 'error'].includes(data.concept.status)) console.log(id, data.concept.preset, data.concept.status, data.concept.durationMs, data.concept.error || '');
    }
  }
  const payload = await json(`/projects/${project.id}`);
  const job = { example: id, projectId: project.id, partials, concepts: [], outputs: [] };
  for (const c of payload.concepts) {
    const preview = `${id}-${c.preset}.jpg`;
    if (c.hasImage) await jpeg(`/concepts/${c.id}/image.png`, preview);
    job.concepts.push({ id: c.id, preset: c.preset, status: c.status, model: c.model, quality: c.quality, size: c.size, seconds: (c.durationMs || 0) / 1000, costUsd: c.costUsd, promptVersion: c.promptVersion, spellcheck: c.spellcheck, error: c.error, preview: c.hasImage ? preview : null });
  }
  // Do not bypass the wording gate, even for a verification artifact.
  const chosen = payload.concepts.find((c) => c.status === 'done' && c.spellcheck?.checked && c.spellcheck.ok);
  if (chosen) {
    for (const kind of ['proof', 'production']) {
      const { output } = await json(`/projects/${project.id}/${kind}`, { conceptId: chosen.id });
      const download = await request(`/outputs/${output.id}/download`);
      if (!download.ok) throw new Error('PDF download failed.');
      fs.writeFileSync(path.join(out, `${id}-${kind}.pdf`), Buffer.from(await download.arrayBuffer()));
      await jpeg(`/outputs/${output.id}/preview.png`, `${id}-${kind}.jpg`);
      job.outputs.push({ kind, id: output.id, conceptId: chosen.id, preflight: output.preflight });
    }
  } else job.proofBlocked = 'No image passed a completed spelling check. No acknowledgement was fabricated.';
  results.jobs.push(job);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
}
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
console.log('Verification artifacts:', out);
