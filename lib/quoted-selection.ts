// Quotes travel inside the prompt text as leading <quote> blocks so the model, the
// .jsonl file and the pi TUI all see plain text; the web UI parses them back into cards.
// `source` is the entry id of the quoted message, used to jump back to it.
export interface Quote {
  text: string;
  source?: string;
}

const LEADING_QUOTE = /^<quote(?: source="([\w-]+)")?>\n([\s\S]*?)\n<\/quote>(?:\n\n|\n?$)/;

export function buildQuotedPrompt(quotes: Quote[], message: string): string {
  const blocks = quotes.map(({ text, source }) => {
    // A literal closing tag inside a quote would end the block early.
    const body = text.trim().replaceAll("</quote>", "</ quote>");
    return `<quote${source && /^[\w-]+$/.test(source) ? ` source="${source}"` : ""}>\n${body}\n</quote>`;
  });
  return [...blocks, message.trim()].filter(Boolean).join("\n\n");
}

/** Draft form: same blocks, but the typed text is kept verbatim (no trim) while editing. */
export function joinQuotedDraft(quotes: Quote[], value: string): string {
  return quotes.length ? `${buildQuotedPrompt(quotes, "")}\n\n${value}` : value;
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
    quotes.push(match[1] ? { text: match[2], source: match[1] } : { text: match[2] });
    rest = rest.slice(match[0].length);
  }
  return { quotes, message: rest };
}
