import { isNullish, isRecord } from "@pockrew/pwr-shared/libs";

/**
 * Enumeration of schema node data types.
 */
export enum SchemaNodeTypeEnum {
  NULL = "null",
  STRING = "string",
  NUMBER = "number",
  BOOLEAN = "boolean",
  OBJECT = "Object",
  ARRAY = "Array",
  MIXED = "mixed",
  UNKNOWN = "unknown",
}

/**
 * Recursive schema node descriptor for JSON/Object trees.
 */
export interface SchemaNode {
  key: string;
  type: string;
  nullable: boolean;
  valueSample?: string;
  rawValue?: unknown;
  children?: SchemaNode[];
}

/**
 * Infers hierarchical SchemaNode tree from arbitrary JSON or parsed objects.
 *
 * @param data - The raw or parsed object data.
 * @param key - The property key or index identifier.
 * @returns Inferred recursive SchemaNode structure.
 */
export const inferSchema = (data: unknown, key = "root"): SchemaNode => {
  // 1. Handle nullish values with early return
  if (isNullish(data)) {
    return {
      key,
      type: SchemaNodeTypeEnum.NULL,
      nullable: true,
      valueSample: "null",
      rawValue: data,
    };
  }

  // 2. Handle array collections
  if (Array.isArray(data)) {
    if (!data.length) {
      return {
        key,
        type: "Array<unknown>",
        nullable: false,
        valueSample: "[]",
        rawValue: data,
        children: [],
      };
    }

    const itemSchemas = data.slice(0, 10).map((item, index) => inferSchema(item, `[${index}]`));
    const firstType = itemSchemas[0]?.type ?? SchemaNodeTypeEnum.UNKNOWN;
    const isUniform = itemSchemas.every((s) => s.type === firstType);
    const itemType = isUniform ? firstType : SchemaNodeTypeEnum.MIXED;

    let valueSample: string;
    if (itemType === SchemaNodeTypeEnum.STRING) {
      valueSample = `[${data.map((v) => JSON.stringify(String(v))).join(", ")}]`;
    } else if (itemType === SchemaNodeTypeEnum.NUMBER || itemType === SchemaNodeTypeEnum.BOOLEAN) {
      valueSample = `[${data.map((v) => String(v)).join(", ")}]`;
    } else {
      valueSample = `[${data.length} items]`;
    }

    // Merge nested object properties if array contains objects
    let unifiedChildren: SchemaNode[] | undefined;
    if (data.some(isRecord)) {
      const childMap = new Map<string, SchemaNode>();
      for (const item of data) {
        if (isRecord(item)) {
          for (const [k, v] of Object.entries(item)) {
            if (!childMap.has(k)) {
              childMap.set(k, inferSchema(v, k));
            }
          }
        }
      }
      unifiedChildren = Array.from(childMap.values());
    }

    return {
      key,
      type: `Array<${itemType}>`,
      nullable: false,
      valueSample,
      rawValue: data,
      children: unifiedChildren,
    };
  }

  // 3. Handle object dictionaries
  if (isRecord(data)) {
    const entries = Object.entries(data);
    const children = entries.map(([k, v]) => inferSchema(v, k));
    return {
      key,
      type: SchemaNodeTypeEnum.OBJECT,
      nullable: false,
      valueSample: `{${entries.length} keys}`,
      rawValue: data,
      children,
    };
  }

  // 4. Handle primitive values
  const primType = typeof data;
  let normalizedType: string = primType;
  switch (primType) {
    case "string":
      normalizedType = SchemaNodeTypeEnum.STRING;
      break;
    case "number":
      normalizedType = SchemaNodeTypeEnum.NUMBER;
      break;
    case "boolean":
      normalizedType = SchemaNodeTypeEnum.BOOLEAN;
      break;
    default:
      normalizedType = primType;
  }

  return {
    key,
    type: normalizedType,
    nullable: false,
    valueSample: String(data),
    rawValue: data,
  };
};

/**
 * Resolves the Badge variant for a given schema node type.
 *
 * @param type - The type string of the node.
 * @returns Matching Badge variant string.
 */
export const getSchemaTypeBadgeVariant = (
  type: string,
): "info" | "secondary" | "success" | "warning" | "destructive" | "outline" => {
  if (type.startsWith("Array")) {
    return "info";
  }

  switch (type) {
    case "file":
      return "info";
    case SchemaNodeTypeEnum.OBJECT:
      return "secondary";
    case SchemaNodeTypeEnum.STRING:
      return "success";
    case SchemaNodeTypeEnum.NUMBER:
      return "warning";
    case SchemaNodeTypeEnum.BOOLEAN:
      return "destructive";
    default:
      return "outline";
  }
};
