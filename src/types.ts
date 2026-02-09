export enum LineType {
  Addition = "Addition",
  Deletion = "Deletion",
  Context = "Context",
}

export enum FileStatus {
  Added = "Added",
  Modified = "Modified",
  Deleted = "Deleted",
  Renamed = "Renamed",
}

export interface DiffLine {
  content: string;
  line_type: LineType;
  old_line_no: number | null;
  new_line_no: number | null;
}

export interface DiffHunk {
  header: string;
  old_start: number;
  old_count: number;
  new_start: number;
  new_count: number;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  old_path: string | null;
  hunks: DiffHunk[];
  status: FileStatus;
}

export interface RepoInfo {
  name: string;
  branch: string;
  path: string;
}

export interface StartupArgs {
  range: string | null;
  remote: string | null;
}

export type ReviewDecision = "approved" | "commented" | "rejected";
export type RejectMode = "propose_alternative" | "request_possibilities";

export interface HunkAnnotation {
  id: string;
  decision: ReviewDecision;
  comment?: string;
  rejectMode?: RejectMode;
  selectedText?: string;
  selectedLines?: { start: number; end: number };
}

/** @deprecated Use HunkAnnotation instead */
export type HunkReview = HunkAnnotation;

export interface FileTreeEntry {
  path: string;
  hunks: number;
  reviewed: number;
}
