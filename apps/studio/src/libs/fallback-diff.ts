import { diffLines, type Change } from "diff";

import type { AlignedDiffLine, AlignedDiffResult, DiffCategory } from "./diff-types";

export const computeFallbackTextDiff = (textA: string, textB: string): AlignedDiffResult => {
  const safeA = textA.endsWith("\n") ? textA : textA ? textA + "\n" : "";
  const safeB = textB.endsWith("\n") ? textB : textB ? textB + "\n" : "";

  if (!safeA && !safeB) {
    return {
      lines: [],
      hasChanges: false,
      diffCount: 0,
      counts: { value: 0, types: 0, attributes: 0 },
      foldableIds: [],
    };
  }

  const chunks: Change[] = diffLines(safeA, safeB);
  const lines: AlignedDiffLine[] = [];
  let lineId = 0;
  let leftLineNum = 1;
  let rightLineNum = 1;
  const counts = { value: 0, types: 0, attributes: 0 };

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk) continue;

    const nextChunk = chunks[i + 1];

    if (!chunk.added && !chunk.removed) {
      const split = chunk.value.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
      for (const line of split) {
        lines.push({
          id: lineId++,
          leftLineNum: leftLineNum++,
          leftText: line,
          rightLineNum: rightLineNum++,
          rightText: line,
          category: null,
        });
      }
    } else if (chunk.removed && nextChunk && nextChunk.added) {
      const removedLines = chunk.value.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
      const addedLines = nextChunk.value.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
      const maxLen = Math.max(removedLines.length, addedLines.length);

      for (let j = 0; j < maxLen; j++) {
        const hasL = j < removedLines.length;
        const hasR = j < addedLines.length;
        const lText = hasL ? (removedLines[j] ?? "") : "";
        const rText = hasR ? (addedLines[j] ?? "") : "";
        const cat: DiffCategory = hasL && hasR ? "value" : "attributes";
        counts[cat]++;

        lines.push({
          id: lineId++,
          leftLineNum: hasL ? leftLineNum++ : null,
          leftText: lText,
          rightLineNum: hasR ? rightLineNum++ : null,
          rightText: rText,
          category: cat,
          leftCategory: hasL ? cat : null,
          rightCategory: hasR ? cat : null,
        });
      }
      i++;
    } else if (chunk.removed) {
      const removedLines = chunk.value.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
      for (const line of removedLines) {
        counts.attributes++;
        lines.push({
          id: lineId++,
          leftLineNum: leftLineNum++,
          leftText: line,
          rightLineNum: null,
          rightText: "",
          category: "attributes",
          leftCategory: "attributes",
          rightCategory: null,
        });
      }
    } else if (chunk.added) {
      const addedLines = chunk.value.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
      for (const line of addedLines) {
        counts.attributes++;
        lines.push({
          id: lineId++,
          leftLineNum: null,
          leftText: "",
          rightLineNum: rightLineNum++,
          rightText: line,
          category: "attributes",
          leftCategory: null,
          rightCategory: "attributes",
        });
      }
    }
  }

  const total = counts.value + counts.types + counts.attributes;
  return {
    lines,
    hasChanges: total > 0,
    diffCount: total,
    counts,
    foldableIds: [],
  };
};
