// Shared by the Proof Merger page and its server code.
export const MERGE_MAX_FILES = 15;
export const MERGE_UPLOAD_MB = 40;

export interface MergePreview {
  /** Pages in the PDF; all of them go into the merged file. */
  pages: number;
  /** First page as a small PNG data URL. */
  image: string;
}
