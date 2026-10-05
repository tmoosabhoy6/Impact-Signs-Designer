// Customer files on a job, shared by the server and the browser app.
// Photos, logos and sketches are lists: a plaque can carry several portraits or a row of
// sponsor logos, and a customer may send more than one sketch.
import type { UploadedFile, UploadedImage, UploadedLogo, Uploads } from './types.js';

/** Upload kinds as they appear in URLs. */
export type UploadKind = 'photo' | 'logo' | 'sketch' | 'site' | 'font';
export type MultiUploadKind = 'photo' | 'logo' | 'sketch';
export const MULTI_KINDS: readonly MultiUploadKind[] = ['photo', 'logo', 'sketch'];
export const isMultiKind = (k: string): k is MultiUploadKind => (MULTI_KINDS as readonly string[]).includes(k);

/** Where each list lives on `Uploads`. */
export const LIST_KEY = { photo: 'photos', logo: 'logos', sketch: 'sketches' } as const satisfies Record<MultiUploadKind, keyof Uploads>;

/**
 * Most files of each kind per job. Photos: up to four frames still leave room for readable
 * text on the smallest plaques. Logos: a sponsor row. The image model takes at most 16
 * reference pictures, and these maxima are what `buildReferences` is proven to fit.
 */
export const UPLOAD_LIMITS: Record<MultiUploadKind, number> = { photo: 4, logo: 6, sketch: 4 };

export const KIND_LABEL: Record<MultiUploadKind, { one: string; many: string }> = {
  photo: { one: 'photo', many: 'photos' },
  logo: { one: 'logo', many: 'logos' },
  sketch: { one: 'sketch', many: 'sketches' },
};

/** Jobs saved before lists existed held one file per kind. */
type LegacyUploads = Partial<Uploads> & {
  photo?: Omit<UploadedImage, 'id'>;
  logo?: Omit<UploadedLogo, 'id'>;
  sketch?: Omit<UploadedFile, 'id'>;
};

/** The stored file name without its extension: unique within a job, so a stable id. */
const idOf = (f: { id?: string; file: string }) => f.id || f.file.replace(/\.[^.]+$/, '');

/**
 * Uploads in their current shape, with keys in a fixed order (snapshots are compared as
 * JSON). Legacy single files become one-item lists; nothing else is changed or dropped.
 */
export function normalizeUploads(input: LegacyUploads | null | undefined): Uploads {
  const u = input ?? {};
  const file = (x: Omit<UploadedFile, 'id'> & { id?: string }): UploadedFile => ({ id: idOf(x), file: x.file, name: x.name, ...(x.hash ? { hash: x.hash } : {}) });
  const image = (x: Omit<UploadedImage, 'id'> & { id?: string }): UploadedImage => ({ ...file(x), width: x.width ?? 0, height: x.height ?? 0 });
  const out: Uploads = {
    photos: (u.photos ?? (u.photo ? [u.photo] : [])).map(image),
    logos: (u.logos ?? (u.logo ? [u.logo] : [])).map((x: Omit<UploadedLogo, 'id'> & { id?: string }) => ({ ...image(x), vectorSource: !!x.vectorSource })),
    sketches: (u.sketches ?? (u.sketch ? [u.sketch] : [])).map(file),
  };
  if (u.site) out.site = u.site;
  if (u.font) out.font = u.font;
  if (u.extra) out.extra = u.extra;
  return out;
}
