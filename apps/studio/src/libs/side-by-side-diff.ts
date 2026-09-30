import { diffLines, type Change } from "diff";

import type { DiffLine, SideBySideDiffResult } from "./diff-types";

export const computeSideBySideDiff = (textA: string, textB: string): SideBySideDiffResult => {
  const safeA = textA.endsWith("\n") ? textA : textA ? `${textA}\n` : "";
  const safeB = textB.endsWith("\n") ? textB : textB ? `${textB}\n` : "";

  if (!safeA && !safeB) {
    return { left: [], right: [], hasChanges: false, diffCount: 0 };
  }

  const chunks: Change[] = diffLines(safeA, safeB);
  const left: DiffLine[] = [];
  const right: DiffLine[] = [];
  let leftLineNum = 1;
  let rightLineNum = 1;
  let diffCount = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk) continue;

    const nextChunk = chunks[i + 1];

    if (!chunk.added && !chunk.removed) {
      const lines = chunk.value.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
      for (const line of lines) {
        left.push({ lineNum: leftLineNum++, text: line, type: "same" });
        right.push({ lineNum: rightLineNum++, text: line, type: "same" });
      }
    } else if (chunk.removed && nextChunk && nextChunk.added) {
      diffCount++;
      const removedLines = chunk.value.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
      const addedLines = nextChunk.value.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
      const maxLen = Math.max(removedLines.length, addedLines.length);

      for (let j = 0; j < maxLen; j++) {
        if (j < removedLines.length) {
          left.push({ lineNum: leftLineNum++, text: removedLines[j] ?? "", type: "removed" });
        } else {
          left.push({ lineNum: null, text: "", type: "empty" });
        }

        if (j < addedLines.length) {
          right.push({ lineNum: rightLineNum++, text: addedLines[j] ?? "", type: "added" });
        } else {
          right.push({ lineNum: null, text: "", type: "empty" });
        }
      }
      i++;
    } else if (chunk.removed) {
      diffCount++;
      const removedLines = chunk.value.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
      for (const line of removedLines) {
        left.push({ lineNum: leftLineNum++, text: line, type: "removed" });
        right.push({ lineNum: null, text: "", type: "empty" });
      }
    } else if (chunk.added) {
      diffCount++;
      const addedLines = chunk.value.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
      for (const line of addedLines) {
        left.push({ lineNum: null, text: "", type: "empty" });
        right.push({ lineNum: rightLineNum++, text: line, type: "added" });
      }
    }
  }

  return {
    left,
    right,
    hasChanges: diffCount > 0,
    diffCount,
  };
};
