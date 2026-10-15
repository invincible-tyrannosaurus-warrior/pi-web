"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";

/** Row-state badge in the meta slot: a 12px filled circle with a white glyph (unread, awaiting input). */
function SessionStateBadge({ label, color, children }: { label: string; color: string; children: ReactNode }) {
  return (
    <span
      role="img"
      title={label}
      aria-label={label}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <circle cx="6" cy="6" r="5" fill={color} />
        {children}
      </svg>
    </span>
  );
}

/** Parked on an extension dialog: the run waits for an answer, so a question mark. */
export function AwaitingSessionIndicator() {
  const { t } = useI18n();
  return (
    <SessionStateBadge label={t("sidebar.awaitingInput")} color="var(--warning)">
      <path d="M4.7 4.6a1.4 1.4 0 0 1 2.7.5c0 .9-1.4 1.1-1.4 1.9" stroke="#ffffff" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6" cy="8.7" r="0.75" fill="#ffffff" />
    </SessionStateBadge>
  );
}

export function UnreadSessionIndicator() {
  const { t } = useI18n();
  return (
    <SessionStateBadge label={t("sidebar.newSessionActivity")} color="var(--success)">
      <path d="M3.6 6.2l1.6 1.6 3.2-3.4" stroke="#ffffff" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </SessionStateBadge>
  );
}
