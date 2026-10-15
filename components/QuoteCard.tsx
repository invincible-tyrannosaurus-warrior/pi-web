"use client";

import { useI18n } from "@/hooks/useI18n";
import { getFileName } from "@/lib/file-paths";
import type { Quote } from "@/lib/quoted-selection";
import { getFileIcon } from "./FileIcons";

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
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17 6H3M21 12H8M21 18H8M3 12v6" />
          </svg>
        )}
        {fileLabel ? (
          <span className="quote-chip-file">
            <span className="quote-chip-title">{fileLabel}</span>
            <span className="quote-chip-text is-code">{quote.text.trim()}</span>
          </span>
        ) : (
          <span className="quote-chip-text">{quote.text}</span>
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
