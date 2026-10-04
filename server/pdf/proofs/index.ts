// Customer proofs in Impact Signs' three locked styles.
import type { PlaqueLayout, PlaqueSpec, Project, Wording } from '../../../shared/types.js';
import { buildStandardProof } from './standard.js';
import { buildDescriptionProof } from './description.js';
import { buildEtchedProof } from './etched.js';

export interface ProofInput {
  jobNumber: string;
  /** Proof version for this job (1 = first proof). */
  version: number;
  spec: PlaqueSpec;
  wording: Wording | null;
  layout: PlaqueLayout | null;
  plaqueImage: Buffer;
  proofNote?: string | null;
  disclaimer?: Project['disclaimer'];
  /** Description sheet. */
  description?: string | null;
  /** The order named the font (it is listed on Description sheets only then). */
  fontStated?: boolean;
  visualScale?: Project['visualScale'];
  sitePhoto?: string | null;
  siteMountHeightIn?: number | null;
  imageExample?: string | null;
  /** Order/version proof page 2: the production outline art. */
  productionPdf?: Buffer | null;
}

export async function buildProof(style: Project['proofStyle'], input: ProofInput): Promise<Buffer> {
  if (style === 'description') return buildDescriptionProof(input);
  if (style === 'etched') return buildEtchedProof(input);
  return buildStandardProof(input);
}
