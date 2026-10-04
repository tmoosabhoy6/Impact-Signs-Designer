// Types shared by the server and the browser app.

export interface PlaqueSpec {
  material: string;
  widthIn: number;
  heightIn: number;
  finish: string;
  backgroundColor: string;
  backgroundTexture: string;
  border: string;
  font: string;
  imageOption: string;
  mounting: string;
  lettering: string;
  /** 'cast' (sand-cast, the default) or 'reverse-etched'. */
  process: string;
  /** Plate thickness in inches when the order states it (e.g. 0.25). */
  thicknessIn: number | null;
  /** Garden stake length in inches (e.g. 24) when mounting is a garden stake. */
  stakeLengthIn: number | null;
}

export type SpecField = keyof PlaqueSpec;

export interface ParseNote {
  field: SpecField | 'general';
  kind: 'assumed' | 'unavailable' | 'conflict' | 'info';
  message: string;
}

export interface ParseResult {
  spec: PlaqueSpec;
  notes: ParseNote[];
  /** Fields whose value was inferred rather than stated. */
  assumed: SpecField[];
  unrecognizedLines: string[];
}

export type WordingRole = 'headline' | 'subhead' | 'body' | 'footer';

export interface TextStyle {
  italic?: boolean;
  bold?: boolean;
  /** Lowercase letters drawn as smaller capitals. */
  smallCaps?: boolean;
}

export interface WordingBlock {
  id: string;
  role: WordingRole;
  /** Exact customer text. A "\n" inside forces a line break. */
  text: string;
  style?: TextStyle;
}

export interface Wording {
  blocks: WordingBlock[];
  notes: string[];
}

export type LayoutPresetId = 'classic' | 'portrait' | 'statement';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A line of type, positioned in inches from the plaque's top-left corner. */
export interface TextLine {
  text: string;
  role: WordingRole;
  /** Horizontal center of the line. */
  cx: number;
  /** Baseline. */
  baseline: number;
  /** Font size in inches (em size). */
  size: number;
  style?: TextStyle;
}

export interface PlaqueLayout {
  preset: LayoutPresetId;
  presetLabel: string;
  presetDescription: string;
  widthIn: number;
  heightIn: number;
  border: { id: string; widthIn: number; innerLine?: Rect; innerLineIn?: number; verified: boolean };
  field: Rect;
  imageFrame: { outer: Rect; inner: Rect; orientation: 'portrait' | 'landscape' | 'square' } | null;
  logo: Rect | null;
  lines: TextLine[];
  warnings: string[];
}

export interface ConceptRecord {
  id: string;
  projectId: string;
  batchId: string;
  parentId: string | null;
  preset: LayoutPresetId;
  status: 'queued' | 'running' | 'done' | 'error';
  kind: 'concept' | 'fix' | 'regenerate';
  note: string;
  prompt: string;
  promptVersion: string;
  model: string;
  quality: string;
  size: string;
  costUsd: number;
  usage: unknown;
  spellcheck: SpellcheckResult | null;
  error: string | null;
  hasImage: boolean;
  createdAt: string;
}

export interface SpellcheckResult {
  ok: boolean;
  checked: boolean;
  differences: { expected: string; seen: string }[];
  message: string;
}

export interface PreflightItem {
  label: string;
  ok: boolean;
  detail: string;
  warnOnly?: boolean;
}

export interface OutputRecord {
  id: string;
  projectId: string;
  kind: 'proof' | 'production';
  conceptId: string | null;
  fileName: string;
  preflight: PreflightItem[] | null;
  createdAt: string;
}

export interface Uploads {
  photo?: { file: string; name: string; width: number; height: number };
  logo?: { file: string; name: string; width: number; height: number; vectorSource: boolean };
  sketch?: { file: string; name: string };
  extra?: { file: string; name: string }[];
}

export type ProofStyle = 'standard' | 'description' | 'etched';

export interface Project {
  id: string;
  jobNumber: string;
  name: string;
  specText: string;
  parse: ParseResult | null;
  spec: PlaqueSpec | null;
  wordingText: string;
  wording: Wording | null;
  uploads: Uploads;
  selectedConceptId: string | null;
  logoSlot: 'auto' | 'top' | 'middle' | 'bottom';
  /** Which locked proof template to use. */
  proofStyle: ProofStyle;
  /** Designer-edited DESCRIPTION text for the Description-sheet proof (null = written from the spec). */
  proofDescription: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
