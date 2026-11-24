import vm from "node:vm";

/**
 * Extracts a top-level `const NAME = { ... }` / `[ ... ]` literal (or the
 * array inside `new Set([ ... ])`) from a JavaScript source file and evaluates
 * it in an isolated VM context.
 *
 * The injected script keeps its translation and icon data as plain object
 * literals, so this avoids shipping a full JS parser just to validate them.
 */
export function extractLiteral(source, name) {
  const marker = `const ${name} = `;
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Could not find ${marker.trim()}`);
  }

  let start = markerIndex + marker.length;
  // Accept `const NAME = new Set([ ... ])` as well as a bare array/object.
  if (source.startsWith("new Set(", start)) {
    start += "new Set(".length;
  }

  const opener = source[start];
  if (opener !== "{" && opener !== "[") {
    throw new Error(`Expected an object or array literal for ${name}`);
  }

  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    } else if (ch === opener) {
      depth += 1;
    } else if (ch === closer) {
      depth -= 1;
      if (depth === 0) {
        return vm.runInNewContext(`(${source.slice(start, i + 1)})`, {});
      }
    }
  }

  throw new Error(`Unterminated literal for ${name}`);
}
