// Browser-side file delivery shared by the export actions.

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking in the same task can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Touch devices: blob downloads are unreliable there (iOS standalone PWAs), the share sheet is not. */
export function prefersShareSheet(): boolean {
  return matchMedia("(pointer: coarse)").matches && typeof navigator.canShare === "function";
}

/**
 * Opens the share sheet for one file. "unavailable" when the browser cannot share it;
 * "expired" when the click's activation ran out before the share call.
 */
async function shareFile(file: File): Promise<"shared" | "canceled" | "unavailable" | "expired"> {
  if (!navigator.canShare?.({ files: [file] })) return "unavailable";
  try {
    await navigator.share({ files: [file] });
    return "shared";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "canceled";
    if (error instanceof DOMException && error.name === "NotAllowedError") return "expired";
    return "unavailable";
  }
}

// Callers put whatever changes the file into the key; the age limit only drops abandoned retries.
const PENDING_SHARE_MS = 30_000;
let pendingShare: { key: string; file: File; at: number } | null = null;

/**
 * Shares a file that takes a while to produce. Safari drops the tap's activation across
 * awaits, so on "retry" the file is kept and the next call with the same key shares it
 * at once. "unavailable": callers download `file` instead.
 */
export async function shareProducedFile(
  key: string,
  produce: () => Promise<File>,
): Promise<{ result: "shared" | "canceled" | "unavailable" | "retry"; file: File }> {
  const ready = pendingShare?.key === key && Date.now() - pendingShare.at < PENDING_SHARE_MS ? pendingShare.file : null;
  pendingShare = null;
  const file = ready ?? await produce();
  const result = await shareFile(file);
  if (result !== "expired") return { result, file };
  if (ready) return { result: "unavailable", file };
  pendingShare = { key, file, at: Date.now() };
  return { result: "retry", file };
}
