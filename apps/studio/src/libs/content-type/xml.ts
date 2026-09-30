/**
 * Converts XML document string into a nested object hierarchy for schema inspection.
 *
 * @param xmlString - The XML string to parse.
 * @returns Record representation of XML elements or null if invalid.
 */
export const parseXmlToObject = (xmlString?: string | null): Record<string, unknown> | null => {
  // 1. Early return if environment does not support DOMParser or string is empty
  if (
    typeof window === "undefined" ||
    typeof DOMParser === "undefined" ||
    !xmlString ||
    !xmlString.trim()
  ) {
    return null;
  }

  try {
    // 2. Parse XML document via browser DOMParser
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString.trim(), "application/xml");
    const parseError = doc.querySelector("parsererror");
    if (parseError) {
      return null;
    }

    // 3. Recursive helper to convert DOM Element to JSON-like object
    const nodeToObject = (node: Element): unknown => {
      const obj: Record<string, unknown> = {};

      // Parse XML attributes
      if (node.attributes.length > 0) {
        for (let i = 0; i < node.attributes.length; i++) {
          const attr = node.attributes[i];
          if (attr) obj[`@${attr.name}`] = attr.value;
        }
      }

      const children = Array.from(node.children);

      // Leaf text node handling
      if (children.length === 0) {
        const text = node.textContent?.trim() ?? "";
        if (Object.keys(obj).length === 0) {
          if (text === "true") return true;
          if (text === "false") return false;
          if (text && !Number.isNaN(Number(text))) return Number(text);
          return text;
        }
        if (text) obj["#text"] = text;
        return obj;
      }

      // Branch node handling with child aggregation
      for (const child of children) {
        const childVal = nodeToObject(child);
        const name = child.tagName;

        if (Object.prototype.hasOwnProperty.call(obj, name)) {
          const existing = obj[name];
          if (Array.isArray(existing)) {
            existing.push(childVal);
          } else {
            obj[name] = [existing, childVal];
          }
        } else {
          obj[name] = childVal;
        }
      }

      return obj;
    };

    // 4. Return root element object
    if (doc.documentElement) {
      return { [doc.documentElement.tagName]: nodeToObject(doc.documentElement) };
    }

    return null;
  } catch {
    return null;
  }
};

/**
 * Formats XML strings with standardized 2-space indentation.
 *
 * @param xml - The raw XML string to format.
 * @returns Beautified XML string.
 */
export const formatXml = (xml?: string | null): string => {
  // 1. Early return if string is empty
  if (!xml || typeof xml !== "string") {
    return "";
  }

  try {
    let formatted = "";
    let indent = 0;
    const parts = xml
      .replace(/>\s*</g, "><")
      .split(/(<[^>]+>)/g)
      .filter(Boolean);

    // 2. Iterate tokens and maintain indent depth
    for (const part of parts) {
      if (part.startsWith("</")) {
        indent = Math.max(0, indent - 1);
        formatted += "  ".repeat(indent) + part + "\n";
      } else if (
        part.startsWith("<") &&
        !part.endsWith("/>") &&
        !part.startsWith("<?") &&
        !part.startsWith("<!")
      ) {
        formatted += "  ".repeat(indent) + part + "\n";
        indent++;
      } else if (part.startsWith("<")) {
        formatted += "  ".repeat(indent) + part + "\n";
      } else if (part.trim()) {
        formatted += "  ".repeat(indent) + part.trim() + "\n";
      }
    }

    return formatted.trim();
  } catch {
    return xml;
  }
};
