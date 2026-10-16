"use client";

import katex from "katex";
import { useI18n } from "@/hooks/useI18n";
import { getFileName } from "@/lib/file-paths";
import type { Quote } from "@/lib/quoted-selection";
import { getFileIcon } from "./FileIcons";

// `$$...$$` or `$...$` (no space just inside the dollars, so "$5 and $10" stays text).
const MATH = /\$\$([\s\S]+?)\$\$|\$(?!\s)([^$\n]+?)(?<!\s)\$/g;

/** Chip preview with formulas typeset inline: a one/two-line chip has no room for display math. */
function renderQuoteMath(text: string) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(MATH)) {
    const display = match[1] != null;
    const before = text.slice(last, match.index);
    // Display math sits on its own lines; inline in the chip it should flow with the text.
    parts.push(display ? before.replace(/\s+$/, " ") : before);
    parts.push(
      <span
        key={match.index}
        dangerouslySetInnerHTML={{ __html: katex.renderToString((match[1] ?? match[2]).trim(), { displayMode: false, throwOnError: false, output: "html" }) }}
      />,
    );
    last = match.index + match[0].length;
    if (display) {
      parts.push(" ");
      last += /^\s*/.exec(text.slice(last))![0].length;
    }
  }
  parts.push(text.slice(last));
  return parts;
}

/**
 * A quoted excerpt, in the composer (removable) and in sent user messages. Clicking it jumps to
 * the quoted message or file lines: ChatWindow handles `data-quote-*` clicks, so no callback is
 * threaded here. No `title`: a native tooltip repeating the excerpt looked noisy.
 */
export function QuoteCard({ quote, onRemove }: { quote: Quote; onRemove?: () => void }) {
  const { t } = useI18n();
  const lines = quote.lines?.replace("-", "–");
  const fileLabel = quote.file ? `${getFileName(quote.file)}${lines ? ` · L${lines}` : ""}` : null;
  const canJump = Boolean(quote.source || quote.file);
  const label = fileLabel ? `${fileLabel}: ${quote.text}` : quote.text;
  return (
    <div className="quote-chip">
      <button
        type="button"
        className="quote-chip-body"
        data-quote-source={quote.source}
        data-quote-file={quote.file}
        data-quote-lines={quote.lines}
        data-quote-text={quote.text}
        disabled={!canJump}
        aria-label={canJump ? `${t("chat.quoteJump")}: ${label}` : label}
      >
        {quote.file ? (
          <span className="quote-chip-icon" aria-hidden="true">{getFileIcon(getFileName(quote.file), 13)}</span>
        ) : (
          // A text excerpt is marked like a blockquote, by a rule; a file keeps its type icon.
          <span className="quote-chip-rule" aria-hidden="true" />
        )}
        {fileLabel ? (
          <span className="quote-chip-file">
            <span className="quote-chip-title">
              {getFileName(quote.file!)}
              {/* Line range is metadata: a tier down, so caps and digits do not outweigh the name. */}
              {lines && <span className="quote-chip-lines"> · L{lines}</span>}
            </span>
            <span className="quote-chip-text is-code">{quote.text.trim()}</span>
          </span>
        ) : (
          <span className="quote-chip-text">{renderQuoteMath(quote.text)}</span>
        )}
      </button>
      {onRemove ? (
        <button type="button" className="quote-chip-remove" onClick={onRemove} title={t("i18n.close")} aria-label={t("i18n.close")}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      ) : null}
    </div>
  );
}
