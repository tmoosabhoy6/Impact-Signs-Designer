// Rebuild compact references after reviewing and indexing new source examples.
// No API calls: originals stay untouched; the app ships only these small copies.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const library = path.join(root, 'references/design-library');
const indexFile = path.join(library, 'index.json');
const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
for (const example of index.examples) {
  const original = fs.readFileSync(path.join(root, 'references/general-purpose-examples', example.source));
  const image = await sharp(original).rotate().resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
  fs.writeFileSync(path.join(library, example.asset), image);
  example.sourceSha256 = hash(original);
  example.sha256 = hash(image);
}
fs.writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');
console.log(`Prepared ${index.examples.length} reviewed examples at a maximum 768 px edge.`);
