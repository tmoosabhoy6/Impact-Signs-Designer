// Shared by the Vectorizer page and its server code.
export type VectorDetail = 'fine' | 'normal' | 'smooth';

export interface VectorOptions {
  /** How closely the outlines follow the pixels. */
  detail: VectorDetail;
  /** Width of the artwork on the PDF page, in inches (the height follows the picture). */
  widthIn: number;
}

export const VECTOR_DEFAULTS: VectorOptions = { detail: 'normal', widthIn: 10 };
export const VECTOR_WIDTH_LIMITS = { minIn: 0.5, maxIn: 96 };
export const VECTOR_UPLOAD_MB = 40;

export interface VectorRecord {
  id: string;
  name: string;
  createdAt: string;
  createdBy: string;
  /** Signed-in account that made it. */
  ownerId?: string;
  options: VectorOptions;
  source: { width: number; height: number; kind: 'image' | 'pdf' | 'svg' };
  /** The traced artwork: page size in inches and how many shapes it has. */
  output: { widthIn: number; heightIn: number; shapes: number };
  /** The marks were read from a plate or card in a photo. */
  fromPlate: boolean;
  /** Share of the artwork that is ink, in percent. */
  inkPct: number;
  ms: number;
}
