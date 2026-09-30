export type DiffCategory = "value" | "types" | "attributes" | null;

export interface AlignedDiffLine {
  id: number;
  leftLineNum: number | null;
  leftText: string;
  rightLineNum: number | null;
  rightText: string;
  category: DiffCategory;
  leftCategory?: DiffCategory;
  rightCategory?: DiffCategory;
  // Folding metadata
  isFoldable?: boolean;
  foldEndId?: number;
  depth?: number;
  leftFoldPlaceholder?: string;
  rightFoldPlaceholder?: string;
}

export interface AlignedDiffResult {
  lines: AlignedDiffLine[];
  hasChanges: boolean;
  diffCount: number;
  counts: {
    value: number;
    types: number;
    attributes: number;
  };
  foldableIds: number[];
}

export type DiffLineType = "same" | "added" | "removed" | "empty";

export interface DiffLine {
  lineNum: number | null;
  text: string;
  type: DiffLineType;
}

export interface SideBySideDiffResult {
  left: DiffLine[];
  right: DiffLine[];
  hasChanges: boolean;
  diffCount: number;
}
