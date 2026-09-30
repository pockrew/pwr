import { isNullish, isRecord } from "@pockrew/pwr-shared/libs";

import type { AlignedDiffLine, AlignedDiffResult, DiffCategory } from "./diff-types";
import { computeFallbackTextDiff } from "./fallback-diff";

const getDetailedType = (val: unknown): string => {
  if (isNullish(val)) return String(val);
  if (Array.isArray(val)) return "array";
  return typeof val;
};

const parseJsonIfPossible = (data: unknown): { parsed: unknown; isJson: boolean } => {
  if (isNullish(data)) {
    return { parsed: data, isJson: false };
  }
  if (isRecord(data) || Array.isArray(data)) {
    return { parsed: data, isJson: true };
  }
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        return { parsed: JSON.parse(trimmed), isJson: true };
      } catch {
        return { parsed: data, isJson: false };
      }
    }
  }
  return { parsed: data, isJson: false };
};

export const computeAlignedDiff = (dataA: unknown, dataB: unknown): AlignedDiffResult => {
  const resA = parseJsonIfPossible(dataA);
  const resB = parseJsonIfPossible(dataB);

  // If neither is JSON or empty, use fallback line diff
  if (
    !resA.isJson &&
    !resB.isJson &&
    typeof resA.parsed === "string" &&
    typeof resB.parsed === "string"
  ) {
    return computeFallbackTextDiff(resA.parsed, resB.parsed);
  }

  const lines: AlignedDiffLine[] = [];
  let lineIdCounter = 0;
  let leftLineCounter = 1;
  let rightLineCounter = 1;
  const counts = { value: 0, types: 0, attributes: 0 };
  const foldableIds: number[] = [];

  const pushLine = (
    leftText: string | null,
    rightText: string | null,
    category: DiffCategory,
    leftCat?: DiffCategory,
    rightCat?: DiffCategory,
    depth: number = 0,
  ): number => {
    if (category) {
      counts[category]++;
    }
    const leftNum = leftText !== null ? leftLineCounter++ : null;
    const rightNum = rightText !== null ? rightLineCounter++ : null;
    const currentId = lineIdCounter++;

    lines.push({
      id: currentId,
      leftLineNum: leftNum,
      leftText: leftText ?? "",
      rightLineNum: rightNum,
      rightText: rightText ?? "",
      category,
      leftCategory: leftCat ?? category,
      rightCategory: rightCat ?? category,
      depth,
    });

    return currentId;
  };

  const dumpSingleSide = (
    val: unknown,
    indent: string,
    keyPrefix: string | undefined,
    isLastInParent: boolean,
    side: "left" | "right",
    depth: number,
  ) => {
    const comma = isLastInParent ? "" : ",";
    const prefix = keyPrefix !== undefined ? `${indent}${JSON.stringify(keyPrefix)}: ` : indent;

    if (isRecord(val)) {
      const obj = val;
      const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b));

      const leftText = side === "left" ? `${prefix}{` : null;
      const rightText = side === "right" ? `${prefix}{` : null;
      const openId = pushLine(
        leftText,
        rightText,
        "attributes",
        side === "left" ? "attributes" : null,
        side === "right" ? "attributes" : null,
        depth,
      );

      const nextIndent = indent + "  ";
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (k === undefined) continue;
        const isLast = i === keys.length - 1;
        dumpSingleSide(obj[k], nextIndent, k, isLast, side, depth + 1);
      }

      const leftClose = side === "left" ? `${indent}}${comma}` : null;
      const rightClose = side === "right" ? `${indent}}${comma}` : null;
      const closeId = pushLine(
        leftClose,
        rightClose,
        "attributes",
        side === "left" ? "attributes" : null,
        side === "right" ? "attributes" : null,
        depth,
      );

      if (keys.length > 0) {
        const startLine = lines.find((l) => l.id === openId);
        if (startLine) {
          startLine.isFoldable = true;
          startLine.foldEndId = closeId;
          if (side === "left") {
            startLine.leftFoldPlaceholder = `${prefix}{...}${comma}`;
          } else {
            startLine.rightFoldPlaceholder = `${prefix}{...}${comma}`;
          }
          foldableIds.push(openId);
        }
      }
      return;
    }

    if (Array.isArray(val)) {
      const arr = val;
      const leftText = side === "left" ? `${prefix}[` : null;
      const rightText = side === "right" ? `${prefix}[` : null;
      const openId = pushLine(
        leftText,
        rightText,
        "attributes",
        side === "left" ? "attributes" : null,
        side === "right" ? "attributes" : null,
        depth,
      );

      const nextIndent = indent + "  ";
      for (let i = 0; i < arr.length; i++) {
        const isLast = i === arr.length - 1;
        dumpSingleSide(arr[i], nextIndent, undefined, isLast, side, depth + 1);
      }

      const leftClose = side === "left" ? `${indent}]${comma}` : null;
      const rightClose = side === "right" ? `${indent}]${comma}` : null;
      const closeId = pushLine(
        leftClose,
        rightClose,
        "attributes",
        side === "left" ? "attributes" : null,
        side === "right" ? "attributes" : null,
        depth,
      );

      if (arr.length > 0) {
        const startLine = lines.find((l) => l.id === openId);
        if (startLine) {
          startLine.isFoldable = true;
          startLine.foldEndId = closeId;
          if (side === "left") {
            startLine.leftFoldPlaceholder = `${prefix}[...]${comma}`;
          } else {
            startLine.rightFoldPlaceholder = `${prefix}[...]${comma}`;
          }
          foldableIds.push(openId);
        }
      }
      return;
    }

    // Primitives
    const text = `${prefix}${JSON.stringify(val)}${comma}`;
    pushLine(
      side === "left" ? text : null,
      side === "right" ? text : null,
      "attributes",
      side === "left" ? "attributes" : null,
      side === "right" ? "attributes" : null,
      depth,
    );
  };

  const diffValues = (
    valA: unknown,
    valB: unknown,
    indent: string,
    keyPrefixA?: string,
    keyPrefixB?: string,
    isLastInParent: boolean = true,
    depth: number = 0,
  ) => {
    const comma = isLastInParent ? "" : ",";
    const prefixA = keyPrefixA !== undefined ? `${indent}${JSON.stringify(keyPrefixA)}: ` : indent;
    const prefixB = keyPrefixB !== undefined ? `${indent}${JSON.stringify(keyPrefixB)}: ` : indent;

    const typeA = getDetailedType(valA);
    const typeB = getDetailedType(valB);

    // If types are different
    if (typeA !== typeB) {
      const textA = valA !== undefined ? `${prefixA}${JSON.stringify(valA, null, 2)}${comma}` : "";
      const textB = valB !== undefined ? `${prefixB}${JSON.stringify(valB, null, 2)}${comma}` : "";
      const linesA = textA ? textA.split("\n") : [];
      const linesB = textB ? textB.split("\n") : [];
      const maxLen = Math.max(linesA.length, linesB.length);
      for (let i = 0; i < maxLen; i++) {
        pushLine(linesA[i] ?? null, linesB[i] ?? null, "types", "types", "types", depth);
      }
      return;
    }

    // Both are objects
    if (isRecord(valA) && isRecord(valB)) {
      const objA = valA;
      const objB = valB;

      const allKeys = Array.from(new Set([...Object.keys(objA), ...Object.keys(objB)])).sort(
        (a, b) => a.localeCompare(b),
      );

      // Opening line
      const openLineId = pushLine(`${prefixA}{`, `${prefixB}{`, null, null, null, depth);

      const nextIndent = indent + "  ";
      for (let i = 0; i < allKeys.length; i++) {
        const key = allKeys[i];
        if (key === undefined) continue;
        const isLast = i === allKeys.length - 1;
        const hasA = Object.prototype.hasOwnProperty.call(objA, key);
        const hasB = Object.prototype.hasOwnProperty.call(objB, key);

        if (hasA && !hasB) {
          dumpSingleSide(objA[key], nextIndent, key, isLast, "left", depth + 1);
        } else if (!hasA && hasB) {
          dumpSingleSide(objB[key], nextIndent, key, isLast, "right", depth + 1);
        } else {
          // Key in both
          diffValues(objA[key], objB[key], nextIndent, key, key, isLast, depth + 1);
        }
      }

      // Closing line
      const closeLineId = pushLine(
        `${indent}}${comma}`,
        `${indent}}${comma}`,
        null,
        null,
        null,
        depth,
      );

      if (allKeys.length > 0) {
        const startLine = lines.find((l) => l.id === openLineId);
        if (startLine) {
          startLine.isFoldable = true;
          startLine.foldEndId = closeLineId;
          startLine.leftFoldPlaceholder = `${prefixA}{...}${comma}`;
          startLine.rightFoldPlaceholder = `${prefixB}{...}${comma}`;
          foldableIds.push(openLineId);
        }
      }
      return;
    }

    // Both are arrays
    if (Array.isArray(valA) && Array.isArray(valB)) {
      const arrA = valA;
      const arrB = valB;
      const maxLen = Math.max(arrA.length, arrB.length);

      const openLineId = pushLine(`${prefixA}[`, `${prefixB}[`, null, null, null, depth);
      const nextIndent = indent + "  ";

      for (let i = 0; i < maxLen; i++) {
        const isLast = i === maxLen - 1;
        const hasA = i < arrA.length;
        const hasB = i < arrB.length;

        if (hasA && !hasB) {
          dumpSingleSide(arrA[i], nextIndent, undefined, isLast, "left", depth + 1);
        } else if (!hasA && hasB) {
          dumpSingleSide(arrB[i], nextIndent, undefined, isLast, "right", depth + 1);
        } else {
          diffValues(arrA[i], arrB[i], nextIndent, undefined, undefined, isLast, depth + 1);
        }
      }

      const closeLineId = pushLine(
        `${indent}]${comma}`,
        `${indent}]${comma}`,
        null,
        null,
        null,
        depth,
      );

      if (maxLen > 0) {
        const startLine = lines.find((l) => l.id === openLineId);
        if (startLine) {
          startLine.isFoldable = true;
          startLine.foldEndId = closeLineId;
          startLine.leftFoldPlaceholder = `${prefixA}[...]${comma}`;
          startLine.rightFoldPlaceholder = `${prefixB}[...]${comma}`;
          foldableIds.push(openLineId);
        }
      }
      return;
    }

    // Primitives
    if (valA === valB) {
      pushLine(
        `${prefixA}${JSON.stringify(valA)}${comma}`,
        `${prefixB}${JSON.stringify(valB)}${comma}`,
        null,
        null,
        null,
        depth,
      );
    } else {
      pushLine(
        `${prefixA}${JSON.stringify(valA)}${comma}`,
        `${prefixB}${JSON.stringify(valB)}${comma}`,
        "value",
        "value",
        "value",
        depth,
      );
    }
  };

  const parsedA = resA.parsed;
  const parsedB = resB.parsed;

  if (parsedA === undefined && parsedB === undefined) {
    return {
      lines: [],
      hasChanges: false,
      diffCount: 0,
      counts: { value: 0, types: 0, attributes: 0 },
      foldableIds: [],
    };
  }

  diffValues(parsedA, parsedB, "");

  const totalDiffs = counts.value + counts.types + counts.attributes;
  return {
    lines,
    hasChanges: totalDiffs > 0,
    diffCount: totalDiffs,
    counts,
    foldableIds,
  };
};
