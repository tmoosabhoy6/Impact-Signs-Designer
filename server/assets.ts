// The static asset library: icons and example images that are pulled for every job.
// Nothing in here is AI-generated. Files live in assets/ and are named in data/catalog.json.
import fs from 'node:fs';
import path from 'node:path';
import { fromRoot } from './config.js';
import { getCatalog, OPTION_GROUPS, type Option } from './catalog.js';

export interface AssetStatus {
  group: string;
  groupLabel: string;
  id: string;
  label: string;
  expected: string;
  found: string | null;
}

const EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];

/** Finds the asset for an option, accepting any common image extension. */
export function findAsset(rel: string | undefined): string | null {
  if (!rel) return null;
  const base = rel.replace(/\.[a-z0-9]+$/i, '');
  for (const ext of [path.extname(rel), ...EXTS]) {
    const p = fromRoot(base + ext);
    if (ext && fs.existsSync(p)) return p;
  }
  return null;
}

export function assetLibraryStatus(): AssetStatus[] {
  const cat = getCatalog();
  const out: AssetStatus[] = [];
  for (const g of OPTION_GROUPS) {
    for (const o of cat[g.key] as Option[]) {
      if (!o.asset) continue;
      const found = findAsset(o.asset);
      out.push({ group: g.key, groupLabel: g.label, id: o.id, label: o.label, expected: o.asset, found: found ? path.relative(fromRoot(), found) : null });
    }
  }
  return out;
}

export function brandLogoFile(): string | null {
  for (const n of ['logo.svg', 'logo.png', 'impact-signs-logo.svg', 'impact-signs-logo.png']) {
    const p = fromRoot('brand-assets', n);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
