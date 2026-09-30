/**
 * Checks if a string contains non-printable binary control characters.
 *
 * @param str - The input string sample to test.
 * @returns True if the string contains substantial binary/control bytes.
 */
export const hasBinaryCharacters = (str?: string | null): boolean => {
  // 1. Early return if empty
  if (!str) {
    return false;
  }

  // 2. Sample up to 1000 characters
  const sample = str.slice(0, 1000);
  let nonPrintable = 0;

  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    // Allow standard whitespace: tab (9), newline (10), carriage return (13)
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      nonPrintable++;
    }
  }

  // 3. Return true if more than 3 non-printable characters found
  return nonPrintable > 3;
};

/**
 * Generates a standard formatted Hex Dump from a string (offset | hex | ASCII).
 *
 * @param input - The string to format as hex dump.
 * @returns Formatted multi-line hex dump representation.
 */
export const formatHexDump = (input?: string | null): string => {
  // 1. Early return if empty
  if (!input) {
    return "";
  }

  const lines: string[] = [];
  const bytes = new TextEncoder().encode(input);
  const total = bytes.length;

  // 2. Iterate in 16-byte chunks
  for (let offset = 0; offset < total; offset += 16) {
    const chunk = bytes.slice(offset, offset + 16);
    const hexParts: string[] = [];
    let asciiPart = "";

    // 3. Convert each byte to hex and readable ASCII
    for (let i = 0; i < 16; i++) {
      if (i < chunk.length) {
        const b = chunk[i] ?? 0;
        hexParts.push(b.toString(16).padStart(2, "0"));
        asciiPart += b >= 32 && b <= 126 ? String.fromCharCode(b) : ".";
      } else {
        hexParts.push("  ");
        asciiPart += " ";
      }

      if (i === 7) {
        hexParts.push("");
      }
    }

    const offsetHex = offset.toString(16).padStart(8, "0");
    const hexString = hexParts.join(" ");
    lines.push(`${offsetHex}  ${hexString}  |${asciiPart}|`);
  }

  return lines.join("\n");
};
