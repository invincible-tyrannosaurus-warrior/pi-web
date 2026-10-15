"use client";

import { useI18n } from "@/hooks/useI18n";
import type { Quote } from "@/lib/quoted-selection";

/**
 * A quoted excerpt, in the composer (removable) and in sent user messages. Clicking it jumps to
 * the quoted message: ChatWindow handles `data-quote-source` clicks, so no callback is threaded here.
 */
export function QuoteCard({ quote, onRemove }: { quote: Quote; onRemove?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="quote-chip">
      <button
        type="button"
        className="quote-chip-body"
        data-quote-source={quote.source}
        data-quote-text={quote.text}
        disabled={!quote.source}
        aria-label={quote.source ? `${t("chat.quoteJump")}: ${quote.text}` : quote.text}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M17 6H3M21 12H8M21 18H8M3 12v6" />
        </svg>
        <span className="quote-chip-text">{quote.text}</span>
      </button>
      {onRemove ? (
        <button type="button" className="quote-chip-remove" onClick={onRemove} title={t("i18n.close")} aria-label={t("i18n.close")}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      ) : null}
    </div>
  );
}
