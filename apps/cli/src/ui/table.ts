import { colorize, colors } from "./ansi";

export interface ITableColumn {
  header: string;
  key: string;
  width?: number;
  align?: "left" | "right" | "center";
}

export type TableRow = Record<string, string | number | boolean | undefined>;

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;

/**
 * Strips ANSI color escape sequences from a string to compute visible text width.
 *
 * @param str - Input string possibly containing ANSI escape sequences.
 * @returns Clean string with escape sequences stripped.
 */
const stripAnsi = (str: string): string => {
  return str.replace(ANSI_REGEX, "");
};

/**
 * Detects whether the current operating system terminal supports UTF-8 box drawing characters.
 *
 * @returns True if Unicode box drawing is supported.
 */
export const isUnicodeSupported = (): boolean => {
  if (process.platform !== "win32") {
    return process.env["TERM"] !== "linux" && process.env["TERM"] !== "dumb";
  }

  return (
    Boolean(process.env["WT_SESSION"]) ||
    Boolean(process.env["TERMINUS_SUBLIME"]) ||
    Boolean(process.env["VSCODE_INJECTION"]) ||
    process.env["ConEmuTask"] === "{cmd::Cmder}" ||
    process.env["TERM_PROGRAM"] === "vscode" ||
    process.env["TERM"] === "xterm-256color" ||
    process.env["TERM"] === "alacritty"
  );
};

const padString = (
  str: string,
  width: number,
  align: "left" | "right" | "center" = "left",
): string => {
  // 1. Calculate visible string length without ANSI color escape codes
  const visibleLength = stripAnsi(str).length;
  if (visibleLength >= width) {
    return str;
  }
  const diff = width - visibleLength;

  // 2. Pad string right-aligned
  if (align === "right") {
    return " ".repeat(diff) + str;
  }

  // 3. Pad string center-aligned
  if (align === "center") {
    const leftPad = Math.floor(diff / 2);
    const rightPad = diff - leftPad;
    return " ".repeat(leftPad) + str + " ".repeat(rightPad);
  }

  // 4. Default pad left-aligned
  return str + " ".repeat(diff);
};

/**
 * Renders an array of record objects as an ASCII or Unicode box-drawn table for CLI output.
 *
 * @param columns - Array of table column configurations.
 * @param rows - Array of table row records.
 * @returns Formatted table string.
 */
export const renderTable = (
  columns: readonly ITableColumn[],
  rows: readonly TableRow[],
): string => {
  // 1. Return empty string if no columns provided
  if (columns.length === 0) return "";

  // 2. Select box characters based on terminal Unicode capability
  const unicode = isUnicodeSupported();
  const box = unicode
    ? {
        topLeft: "┌─",
        topMid: "─┬─",
        topRight: "─┐",
        midLeft: "├─",
        midMid: "─┼─",
        midRight: "─┤",
        botLeft: "└─",
        botMid: "─┴─",
        botRight: "─┘",
        vert: "│",
        horiz: "─",
      }
    : {
        topLeft: "+-",
        topMid: "-+-",
        topRight: "-+",
        midLeft: "+-",
        midMid: "-+-",
        midRight: "-+",
        botLeft: "+-",
        botMid: "-+-",
        botRight: "-+",
        vert: "|",
        horiz: "-",
      };

  // 3. Compute column widths based on headers, contents, and explicit configurations
  const computedWidths: number[] = columns.map((col) => {
    const colHeaderLen = stripAnsi(col.header).length;
    let maxContentLen = colHeaderLen;

    for (const row of rows) {
      const val = row[col.key];
      const strVal = val !== undefined ? String(val) : "";
      const len = stripAnsi(strVal).length;
      if (len > maxContentLen) {
        maxContentLen = len;
      }
    }

    return col.width !== undefined ? Math.max(col.width, maxContentLen) : maxContentLen;
  });

  // 4. Build horizontal line separator borders
  const sepTop =
    box.topLeft + computedWidths.map((w) => box.horiz.repeat(w)).join(box.topMid) + box.topRight;
  const sepMid =
    box.midLeft + computedWidths.map((w) => box.horiz.repeat(w)).join(box.midMid) + box.midRight;
  const sepBottom =
    box.botLeft + computedWidths.map((w) => box.horiz.repeat(w)).join(box.botMid) + box.botRight;

  // 5. Format table header row
  const headerCells = columns.map((col, i) => {
    const width = computedWidths[i] ?? stripAnsi(col.header).length;
    const padded = padString(col.header, width, col.align ?? "left");
    return colorize(padded, colors.bold);
  });
  const headerLine = `${box.vert} ` + headerCells.join(` ${box.vert} `) + ` ${box.vert}`;

  // 6. Format table body rows
  const rowLines: string[] = [];
  for (const row of rows) {
    const cells = columns.map((col, i) => {
      const width = computedWidths[i] ?? 10;
      const val = row[col.key];
      const strVal = val !== undefined ? String(val) : "";
      return padString(strVal, width, col.align ?? "left");
    });
    rowLines.push(`${box.vert} ` + cells.join(` ${box.vert} `) + ` ${box.vert}`);
  }

  // 7. Assemble full table lines with borders and handle empty row state
  const lines: string[] = [colorize(sepTop, colors.dim), headerLine, colorize(sepMid, colors.dim)];

  if (rowLines.length === 0) {
    const totalInnerWidth =
      computedWidths.reduce((sum, w) => sum + w, 0) + (columns.length - 1) * 3;
    const emptyMsg = padString(
      colorize("(No records found)", colors.dim),
      totalInnerWidth,
      "center",
    );
    lines.push(`${box.vert} ` + emptyMsg + ` ${box.vert}`);
  } else {
    for (const r of rowLines) {
      lines.push(r);
    }
  }

  // 8. Append bottom border and return combined table string
  lines.push(colorize(sepBottom, colors.dim));

  return lines.join("\n");
};
