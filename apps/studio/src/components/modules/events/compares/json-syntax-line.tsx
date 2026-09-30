import { createMemo, For, Match, Switch, type Component } from "solid-js";

export enum JsonTokenTypeEnum {
  Key = "key",
  String = "string",
  Number = "number",
  Boolean = "boolean",
  Null = "null",
  Punctuation = "punctuation",
  Plain = "plain",
}

export interface JsonToken {
  text: string;
  type: JsonTokenTypeEnum;
}

/**
 * Tokenizes the remainder of a JSON value string into structured syntax tokens.
 *
 * @param rest - Text following the key/colon prefix
 * @param tokens - Mutable array of tokens to append to
 */
function tokenizeRest(rest: string, tokens: JsonToken[]): void {
  // 1. Check and strip trailing comma
  let content = rest;
  let hasComma = false;
  if (content.endsWith(",")) {
    hasComma = true;
    content = content.slice(0, -1);
  }

  const trimmed = content.trim();

  // 2. Check for exact structural/literal match via switch
  switch (trimmed) {
    case "{":
    case "}":
    case "[":
    case "]":
      tokens.push({ text: content, type: JsonTokenTypeEnum.Punctuation });
      break;

    case "true":
    case "false":
      tokens.push({ text: content, type: JsonTokenTypeEnum.Boolean });
      break;

    case "null":
      tokens.push({ text: content, type: JsonTokenTypeEnum.Null });
      break;

    default:
      // 3. Fall back to pattern checks for numbers, strings, or plain text
      if (!isNaN(Number(trimmed)) && trimmed !== "") {
        tokens.push({ text: content, type: JsonTokenTypeEnum.Number });
      } else if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        tokens.push({ text: content, type: JsonTokenTypeEnum.String });
      } else {
        tokens.push({ text: content, type: JsonTokenTypeEnum.Plain });
      }
      break;
  }

  // 4. Append trailing comma punctuation if present
  if (hasComma) {
    tokens.push({ text: ",", type: JsonTokenTypeEnum.Punctuation });
  }
}

/**
 * Tokenizes a single line of formatted JSON text into styled tokens for lightweight syntax highlighting.
 *
 * @param line - Raw line text from the aligned diff
 * @returns Array of typed tokens
 */
export function tokenizeJsonLine(line: string): JsonToken[] {
  // 1. Guard against empty line
  if (!line) {
    return [{ text: "", type: JsonTokenTypeEnum.Plain }];
  }

  const tokens: JsonToken[] = [];

  // 2. Match JSON property line: (indent)("key")(: )(rest)
  const kvMatch = line.match(/^(\s*)("(?:\\.|[^"\\])*")(\s*:\s*)(.*)$/);
  if (kvMatch) {
    const [, indent, key, colon, rest] = kvMatch;
    if (indent) tokens.push({ text: indent, type: JsonTokenTypeEnum.Plain });
    if (key) tokens.push({ text: key, type: JsonTokenTypeEnum.Key });
    if (colon) tokens.push({ text: colon, type: JsonTokenTypeEnum.Punctuation });

    if (rest) {
      tokenizeRest(rest, tokens);
    }
    return tokens;
  }

  // 3. Match non-property line (array items, brackets, primitives, plain text)
  const indentMatch = line.match(/^(\s*)(.*)$/);
  const indent = indentMatch ? indentMatch[1] : "";
  const rest = indentMatch ? indentMatch[2] : line;

  if (indent) tokens.push({ text: indent, type: JsonTokenTypeEnum.Plain });
  if (rest) tokenizeRest(rest, tokens);

  return tokens;
}

/**
 * CodeMirror-style adaptive syntax highlighter for a single line of JSON.
 * Utilizes Solid's Switch/Match for declarative token type rendering.
 */
export const JsonSyntaxLine: Component<{ text: string }> = (props) => {
  const tokens = createMemo(() => tokenizeJsonLine(props.text));

  return (
    <For each={tokens()}>
      {(token) => (
        <Switch fallback={<span class="text-foreground dark:text-[#abb2bf]">{token.text}</span>}>
          <Match when={token.type === JsonTokenTypeEnum.Key}>
            <span class="font-medium text-sky-700 dark:text-[#e06c75]">{token.text}</span>
          </Match>
          <Match when={token.type === JsonTokenTypeEnum.String}>
            <span class="text-emerald-700 dark:text-[#98c379]">{token.text}</span>
          </Match>
          <Match when={token.type === JsonTokenTypeEnum.Number}>
            <span class="text-amber-700 dark:text-[#d19a66]">{token.text}</span>
          </Match>
          <Match when={token.type === JsonTokenTypeEnum.Boolean}>
            <span class="text-teal-700 dark:text-[#56b6c2]">{token.text}</span>
          </Match>
          <Match when={token.type === JsonTokenTypeEnum.Null}>
            <span class="text-purple-700 dark:text-[#c678dd]">{token.text}</span>
          </Match>
          <Match when={token.type === JsonTokenTypeEnum.Punctuation}>
            <span class="text-foreground/75 dark:text-[#abb2bf]">{token.text}</span>
          </Match>
        </Switch>
      )}
    </For>
  );
};
