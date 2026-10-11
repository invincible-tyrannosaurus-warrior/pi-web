/**
 * Open folders of the file tree, remembered per cwd so switching projects and
 * back keeps them. A cwd without open folders is forgotten, and at most 20 cwds
 * are kept, least recently used dropped first. Storage is best effort: missing,
 * full or malformed storage reads as nothing open.
 */
export const FILE_TREE_EXPANSION_STORAGE_KEY = "pi-web:file-tree-expansion";
export const MAX_REMEMBERED_FILE_TREE_CWDS = 20;

type ExpansionEntry = { cwd: string; paths: string[] };
type ExpansionStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): ExpansionStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function isEntry(value: unknown): value is ExpansionEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<ExpansionEntry>;
  return typeof entry.cwd === "string" && Array.isArray(entry.paths)
    && entry.paths.every((path) => typeof path === "string");
}

function readEntries(storage: ExpansionStorage | undefined): ExpansionEntry[] {
  try {
    const value: unknown = JSON.parse(storage?.getItem(FILE_TREE_EXPANSION_STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter(isEntry) : [];
  } catch {
    return [];
  }
}

/** The folders open under cwd when it was last left, most recent first in storage. */
export function readExpandedPaths(cwd: string, storage: ExpansionStorage | undefined = browserStorage()): string[] {
  return readEntries(storage).find((entry) => entry.cwd === cwd)?.paths ?? [];
}

/** Records the open folders under cwd and makes cwd the most recently used; no open folders forgets it. */
export function rememberExpandedPaths(
  cwd: string,
  paths: readonly string[],
  storage: ExpansionStorage | undefined = browserStorage(),
): void {
  const others = readEntries(storage).filter((entry) => entry.cwd !== cwd);
  const entries = paths.length > 0 ? [{ cwd, paths: [...paths] }, ...others] : others;
  try {
    storage?.setItem(FILE_TREE_EXPANSION_STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_REMEMBERED_FILE_TREE_CWDS)));
  } catch {
    // Quota or a disabled store: the tree simply starts collapsed next time.
  }
}
