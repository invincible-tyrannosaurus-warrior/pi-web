// Quotes travel inside the prompt text as leading <quote> blocks so the model, the
// .jsonl file and the pi TUI all see plain text; the web UI parses them back into cards.
// `source` is the entry id of a quoted chat message; `file` (as mentioned in the chat's cwd)
// and `lines` ("12" or "10-20") mark an excerpt attached from the file viewer.
export interface Quote {
  text: string;
  source?: string;
  file?: string;
  lines?: string;
}

const LEADING_QUOTE = /^<quote((?: \w+="[^"]*")*)>\n([\s\S]*?)\n<\/quote>(?:\n\n|\n?$)/;
const ATTRIBUTE = / (\w+)="([^"]*)"/g;

const escapeAttribute = (value: string) => value.replace(/[\r\n]/g, " ").replaceAll("&", "&amp;").replaceAll("\"", "&quot;");
const unescapeAttribute = (value: string) => value.replaceAll("&quot;", "\"").replaceAll("&amp;", "&");

/** Drops surrounding blank lines but keeps the first line's indentation (code excerpts). */
export function trimQuoteText(text: string): string {
  return text.replace(/^(?:[ \t]*\r?\n)+/, "").trimEnd();
}

export function buildQuotedPrompt(quotes: Quote[], message: string): string {
  const blocks = quotes.map(({ text, source, file, lines }) => {
    const attributes = [
      source && /^[\w-]+$/.test(source) ? ` source="${source}"` : "",
      file ? ` file="${escapeAttribute(file)}"` : "",
      file && lines && /^\d+(?:-\d+)?$/.test(lines) ? ` lines="${lines}"` : "",
    ].join("");
    // A literal closing tag inside a quote would end the block early.
    return `<quote${attributes}>\n${trimQuoteText(text).replaceAll("</quote>", "</ quote>")}\n</quote>`;
  });
  return [...blocks, message.trim()].filter(Boolean).join("\n\n");
}

/** Draft form: same blocks, but the typed text is kept verbatim (no trim) while editing. */
export function joinQuotedDraft(quotes: Quote[], value: string): string {
  return quotes.length ? `${buildQuotedPrompt(quotes, "")}\n\n${value}` : value;
}

/**
 * Browser only: the selected text with KaTeX formulas turned back into `$tex$` / `$$tex$$`.
 * KaTeX renders MathML + HTML twice, so plain selection.toString() duplicates and splits
 * formulas; a selection ending inside a formula is widened to the whole formula first.
 */
export function selectedTextWithTex(range: Range): string {
  const formulaAt = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest(".katex-display, .katex");
  const widened = range.cloneRange();
  const start = formulaAt(range.startContainer);
  const end = formulaAt(range.endContainer);
  if (start) widened.setStartBefore(start);
  if (end) widened.setEndAfter(end);
  const holder = document.createElement("div");
  holder.style.cssText = "position:fixed;left:-9999px;white-space:pre-wrap";
  holder.append(widened.cloneContents());
  holder.querySelectorAll(".katex").forEach((el) => {
    const tex = el.querySelector("annotation[encoding=\"application/x-tex\"]")?.textContent;
    if (!tex) return;
    const display = el.closest(".katex-display") != null;
    el.replaceWith(display ? `\n$$\n${tex}\n$$\n` : `$${tex}$`);
  });
  document.body.append(holder);
  const text = holder.innerText.trim();
  holder.remove();
  return text;
}

/**
 * Locates a quote in a message's text nodes so the jump can highlight it. Matches the first
 * line only: the quote came from innerText, which adds newlines between blocks.
 */
export function findQuoteInSegments(segments: string[], quote: string): { start: [number, number]; end: [number, number] } | null {
  const needle = quote.trim().split("\n")[0].trim();
  if (!needle) return null;
  const index = segments.join("").indexOf(needle);
  if (index < 0) return null;
  const locate = (offset: number, preferNext: boolean): [number, number] => {
    let base = 0;
    for (let i = 0; i < segments.length; i++) {
      const end = base + segments[i].length;
      if (offset < end || (offset === end && !preferNext)) return [i, offset - base];
      base = end;
    }
    return [segments.length - 1, segments[segments.length - 1].length];
  };
  return { start: locate(index, true), end: locate(index + needle.length, false) };
}

export function splitQuotedPrompt(text: string): { quotes: Quote[]; message: string } {
  const quotes: Quote[] = [];
  let rest = text;
  for (let match = LEADING_QUOTE.exec(rest); match; match = LEADING_QUOTE.exec(rest)) {
    const quote: Quote = { text: match[2] };
    for (const [, name, value] of match[1].matchAll(ATTRIBUTE)) {
      if (name === "source" || name === "file" || name === "lines") quote[name] = unescapeAttribute(value);
    }
    quotes.push(quote);
    rest = rest.slice(match[0].length);
  }
  return { quotes, message: rest };
}
