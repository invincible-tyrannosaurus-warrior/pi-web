import type { FileViewerState } from "@/lib/file-viewer-state";
import type { Tab } from "./TabBar";

interface OpenFileTabInput {
  cwd?: string;
  fileName: string;
  filePath: string;
  modeHint?: "diff";
  /** PDF page to open, from a `#page=` link fragment. */
  page?: number;
  sourceSessionId?: string | null;
  tabId: string;
}

export function openFileTab(tabs: Tab[], input: OpenFileTabInput): Tab[] {
  const existing = tabs.find((tab) => tab.id === input.tabId);
  if (!existing) {
    return [...tabs, {
      id: input.tabId,
      label: input.fileName,
      filePath: input.filePath,
      cwd: input.cwd,
      sourceSessionId: input.sourceSessionId,
      initialDisplayMode: input.modeHint,
      ...(input.page !== undefined ? { pdfPage: input.page } : {}),
      viewerState: input.modeHint ? {
        displayMode: input.modeHint,
        wrapLines: false,
        scrollTop: 0,
        scrollLeft: 0,
      } : undefined,
      viewerRevision: 0,
    }];
  }

  const sourceChanged = Boolean(
    input.sourceSessionId && existing.sourceSessionId !== input.sourceSessionId,
  );
  const cwdChanged = Boolean(input.cwd && existing.cwd !== input.cwd);
  // Opening a different page of the same file must remount the viewer, because
  // the page lives in the iframe URL.
  // Opening a different page of the same file must remount the viewer, because the
  // page lives in the iframe URL. A plain open (no fragment) clears any page the tab
  // was left on, so opening the same PDF from the file tree returns to page 1.
  const pageChanged = (input.page ?? undefined) !== existing.pdfPage;
  if (!sourceChanged && !cwdChanged && !input.modeHint && !pageChanged) return tabs;

  return tabs.map((tab) => {
    if (tab.id !== input.tabId) return tab;
    const next: Tab = { ...tab };
    if (sourceChanged) next.sourceSessionId = input.sourceSessionId;
    if (cwdChanged) next.cwd = input.cwd;
    if (pageChanged) {
      next.pdfPage = input.page;
      next.viewerRevision = (tab.viewerRevision ?? 0) + 1;
    }
    if (input.modeHint) {
      next.initialDisplayMode = input.modeHint;
      next.viewerState = {
        displayMode: input.modeHint,
        wrapLines: tab.viewerState?.wrapLines ?? false,
        scrollTop: 0,
        scrollLeft: 0,
        loadedBytes: tab.viewerState?.loadedBytes,
        scrollByMode: {
          ...tab.viewerState?.scrollByMode,
          diff: { scrollTop: 0, scrollLeft: 0 },
        },
      };
      next.viewerRevision = (tab.viewerRevision ?? 0) + 1;
    } else if (sourceChanged || cwdChanged) {
      next.viewerRevision = (tab.viewerRevision ?? 0) + 1;
    }
    return next;
  });
}

export interface FileWorkspaceState {
  tabs: Tab[];
  activeTabId: string | null;
  open: boolean;
}

// A parked workspace keeps the generation its tabs were live in: the viewer that
// unmounts after the switch reports under it, so its state lands in these tabs
// even when the workspace switched to has the same file open.
export interface ParkedFileWorkspace extends FileWorkspaceState {
  generation: number;
}

export function switchFileWorkspace(
  states: Map<string, ParkedFileWorkspace>,
  currentKey: string | null,
  nextKey: string,
  current: FileWorkspaceState,
  generation: number,
): FileWorkspaceState {
  if (currentKey === nextKey) return current;
  if (currentKey) states.set(currentKey, { ...current, generation });
  const parked = states.get(nextKey);
  if (!parked) return { tabs: [], activeTabId: null, open: false };
  // Live tabs are never parked: the map holds only the workspaces left.
  states.delete(nextKey);
  return { tabs: parked.tabs, activeTabId: parked.activeTabId, open: parked.open };
}

export function saveParkedFileViewerState(
  states: Map<string, ParkedFileWorkspace>,
  generation: number,
  tabId: string,
  viewerRevision: number,
  viewerState: FileViewerState,
): void {
  for (const [key, workspace] of states) {
    if (workspace.generation !== generation) continue;
    states.set(key, { ...workspace, tabs: saveFileViewerState(workspace.tabs, tabId, viewerRevision, viewerState) });
    return;
  }
}

export function saveFileViewerState(
  tabs: Tab[],
  tabId: string,
  viewerRevision: number,
  viewerState: FileViewerState,
): Tab[] {
  const index = tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1 || (tabs[index].viewerRevision ?? 0) !== viewerRevision) return tabs;

  const next = [...tabs];
  next[index] = { ...next[index], viewerState };
  return next;
}

export function getAdjacentTabId(tabs: Tab[], closingId: string): string | null {
  const closingIndex = tabs.findIndex((tab) => tab.id === closingId);
  if (closingIndex === -1) return null;
  const remaining = tabs.filter((tab) => tab.id !== closingId);
  return remaining[Math.min(closingIndex, remaining.length - 1)]?.id ?? null;
}
