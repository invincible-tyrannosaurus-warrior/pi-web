/**
 * Copies text that is still loading. Safari refuses a clipboard write made after an
 * await, so the write starts inside the click and receives the pending text.
 */
export function copyPendingText(text: Promise<string>): Promise<void> {
  if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    const blob = text.then((value) => new Blob([value], { type: "text/plain" }));
    blob.catch(() => {}); // write() may reject before reading it; the caller sees the failure via write().
    return navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
  }
  return text.then(copyText);
}

export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return Promise.resolve();
  } catch {
    return Promise.reject();
  }
}
