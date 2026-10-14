"use client";

import { createContext, useContext, useState } from "react";
import type { NoticeType } from "@/hooks/useAgentSession";
import { useConfirm } from "@/hooks/useConfirm";
import { useI18n } from "@/hooks/useI18n";
import { exportMessageImage, type MessageImageResult } from "@/lib/message-image";

/** Chat-level toasts; message actions report their outcome through it. */
export const MessageNoticeContext = createContext<((notice: { message: string; type?: NoticeType }) => void) | null>(null);

/** Export an element (an answer, a table, a diagram) as an image, with the chat's feedback. */
export function useExportImage() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const addNotice = useContext(MessageNoticeContext);
  const [state, setState] = useState<"idle" | "busy" | MessageImageResult>("idle");
  const done = state !== "idle" && state !== "busy";

  const run = (el: HTMLElement | null, fileName: string) => {
    if (!el || state === "busy") return;
    setState("busy");
    exportMessageImage(el, fileName).then(
      (result) => {
        if (result === "canceled") return setState("idle");
        if (result === "retry") {
          setState("idle");
          addNotice?.({ type: "info", message: t("i18n.imageTapToShare") });
          return;
        }
        setState(result);
        setTimeout(() => setState("idle"), 1500);
        // The share sheet is its own feedback; copy and download happen silently.
        if (result === "copied") addNotice?.({ type: "success", message: t("i18n.imageCopied") });
        if (result === "downloaded") addNotice?.({ type: "success", message: t("i18n.imageDownloaded") });
      },
      (error) => {
        console.error(error);
        setState("idle");
        if (addNotice) addNotice({ type: "error", message: t("i18n.exportImageFailed") });
        else void confirm(t("i18n.exportImageFailed"), { alert: true });
      },
    );
  };

  const title = state === "copied" ? t("i18n.imageCopied") : state === "downloaded" ? t("i18n.imageDownloaded") : t("i18n.exportImage");
  return { busy: state === "busy", done, title, run };
}

export function ExportImageIcon({ done, size = 12 }: { done: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {done ? <polyline points="20 6 9 17 4 12" /> : (
        <>
          <path d="M10.3 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10l-3.1-3.1a2 2 0 0 0-2.814.014L6 21" />
          <path d="m14 19 3 3v-5.5" />
          <path d="m17 22 3-3" />
          <circle cx="9" cy="9" r="2" />
        </>
      )}
    </svg>
  );
}
