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
  /** Catalog logo treatment: raised cast, monochrome UV print, or color UV print. */
  logoTreatment: string;
  /** Plate thickness in inches when the order states it (e.g. 0.25). */
  thicknessIn: number | null;
  /** Garden stake length in inches (e.g. 24) when mounting is a garden stake. */
  stakeLengthIn: number | null;
  /** Name of a font the order asks for that is not in the catalog (font = 'custom'). */
  customFontName: string | null;
  /** Custom paint match when backgroundColor = 'custom' (e.g. "Dark Blue 2050"). */
  customPaint: { name: string; hex: string } | null;
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
  /** Font for this line only (catalog font id); otherwise the plaque font. */
  font?: string;
  /** Set the lines of this block in 2–4 columns (donor lists). */
  columns?: number;
  /** Text alignment inside its column (default centered). */
  align?: 'center' | 'left';
  /** A raised rule under this line (section headings). */
  ruleBelow?: boolean;
  /** Size multiplier for this line (1 = the role's normal size). */
  size?: number;
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

export type WordingEdit =
  | { op: 'replace_text'; blockId: string; from: string; to: string }
  | { op: 'insert_block'; afterId: string | null; text: string; role: WordingRole }
  | { op: 'delete_block'; blockId: string }
  | { op: 'set_role'; blockId: string; role: WordingRole }
  | { op: 'set_style'; blockId: string; style: TextStyle };

/** Designer adjustments to one layout column, applied by the layout engine (1 = unchanged). */
export interface LayoutAdjust {
  /** All text larger or smaller. */
  textScale?: number;
  /** Space between lines and groups. */
  spacing?: number;
  /** Image (photo) frame size; with several photos, the whole group. */
  imageScale?: number;
  /** Logo size; with several logos, the whole row. */
  logoScale?: number;
  /** Where the content sits in the free space: -1 top, 0 centered, 1 bottom. */
  verticalOffset?: number;
}

/** Order-level layout moves (they apply to every layout column). */
export interface PlacementPatch {
  /** Put the image after this wording block (index); null = image first. */
  imageAfterBlock?: number | null;
  logoSlot?: 'auto' | 'top' | 'middle' | 'bottom';
  logos?: { logoId: string; position: LogoPosition }[];
}

export type InstructionPlan =
  | { kind: 'visual'; restated: string }
  /** Several changes at once; each part goes through its own checked path. */
  | {
      kind: 'edit';
      restated: string;
      specPatch?: Partial<PlaqueSpec>;
      wordingEdits?: WordingEdit[];
      /** Relative multipliers/offsets on the column's current adjustments. */
      layoutPatch?: LayoutAdjust;
      placement?: PlacementPatch;
      /** Change made by the image model on top of the layout (image only). */
      imageEdit?: string;
    }
  | { kind: 'spec'; restated: string; specPatch: Partial<PlaqueSpec> }
  | { kind: 'wording'; restated: string; wordingEdits: WordingEdit[] }
  | { kind: 'refuse'; reason: string; nearestOptions: string[] };

export interface ContentSnapshot {
  spec: PlaqueSpec | null;
  wording: Wording | null;
  wordingText: string;
  parse: ParseResult | null;
  logoSlot?: Project['logoSlot'];
  imageAfterBlock?: Project['imageAfterBlock'];
  uploads?: Project['uploads'];
  layoutAdjust?: Project['layoutAdjust'];
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
  /** For left-aligned (column) text: the left edge. */
  x?: number;
  /** Server-side: the font file this line is drawn with. */
  face?: string;
}

export interface ImageFrame {
  /** The uploaded photo in this frame; missing for a placeholder. */
  photoId?: string;
  outer: Rect;
  /** The photo window inside the raised frame. */
  inner: Rect;
  orientation: 'portrait' | 'landscape' | 'square';
}

export interface LogoBox extends Rect {
  /** The uploaded logo drawn in this box. */
  logoId?: string;
}

export interface PlaqueLayout {
  preset: LayoutPresetId;
  presetLabel: string;
  presetDescription: string;
  widthIn: number;
  heightIn: number;
  border: { id: string; widthIn: number; innerLine?: Rect; innerLineIn?: number; verified: boolean };
  field: Rect;
  /** One raised frame per photo, in upload order (a placeholder frame when no photo is uploaded yet). */
  imageFrames: ImageFrame[];
  /** One box per logo, in upload order. */
  logos: LogoBox[];
  lines: TextLine[];
  /** Raised horizontal rules (section headings). */
  rules: Rect[];
  /** Face screw / rosette positions (centers) with their diameter. */
  screws: { cx: number; cy: number; d: number }[];
  /** Height of the smallest letters on the plaque, in inches. */
  minLetterIn: number | null;
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
  /** Original designer request, preserved independently of the planner summary. */
  instruction?: string;
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
  plan?: InstructionPlan;
  previous?: ContentSnapshot;
  /** Content used to generate this version, including before Undo or a later edit. */
  snapshot?: ContentSnapshot;
  durationMs?: number;
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
  /** The layout it was made from. Older records only name the concept. */
  preset?: LayoutPresetId;
  /** A proof of several images: one page per image, in page order (conceptId is the first). */
  conceptIds?: string[];
  /** The layout of each page, in page order. */
  presets?: LayoutPresetId[];
  fileName: string;
  preflight: PreflightItem[] | null;
  createdAt: string;
}

/** A stored customer file. `id` is unique within the job and never reused. */
export interface UploadedFile {
  id: string;
  /** Working PNG (or the original, for fonts) in the job's uploads folder. */
  file: string;
  /** File name as the designer uploaded it. */
  name: string;
  /** SHA-256 of the original file, to catch the same file added twice (missing on older jobs). */
  hash?: string;
}

export interface UploadedImage extends UploadedFile {
  width: number;
  height: number;
}

export type LogoPosition = 'auto' | 'top' | 'bottom' | 'left' | 'right';

export interface UploadedLogo extends UploadedImage {
  /** Per-logo position; absent/auto follows the existing order placement. */
  position?: LogoPosition;
  /** Supplied as SVG / PDF / AI / EPS (traced from a high-resolution render). */
  vectorSource: boolean;
}

export interface Uploads {
  /** Photos on the plaque, in order: left to right, then top to bottom. */
  photos: UploadedImage[];
  /** Logos on the plaque, in order, left to right. */
  logos: UploadedLogo[];
  /** Customer sketches: direction for the image model only, never drawn on the plaque. */
  sketches: UploadedFile[];
  /** Photo of the installation site for the Description sheet's scale panel. */
  site?: { file: string; name: string; width: number; height: number };
  /** A font file supplied for this job (custom font). */
  font?: { file: string; name: string };
  extra?: { file: string; name: string }[];
}

/** Proof templates. The app makes the Description sheet; the others are kept for the measured samples and tests. */
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
  /** The images going on the customer proof, one page each in this order (at most MAX_PROOF_PAGES). */
  proofConceptIds: string[];
  logoSlot: 'auto' | 'top' | 'middle' | 'bottom';
  /** Designer-edited DESCRIPTION text for the proof (null = written from the spec). */
  proofDescription: string | null;
  /** Put the image after this wording block (index); null = image at the top / left. */
  imageAfterBlock: number | null;
  /** Designer layout adjustments per layout column (from Fix instructions). */
  layoutAdjust?: Partial<Record<LayoutPresetId, LayoutAdjust>>;
  /** Red note printed under the plaque on the proof. */
  proofNote: string | null;
  createdBy: string;
  /** Signed-in account that owns this job (missing on jobs from before sign-in accounts). */
  ownerId?: string;
  createdAt: string;
  updatedAt: string;
}
