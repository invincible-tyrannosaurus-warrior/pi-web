import assert from "node:assert/strict";
import test from "node:test";

import { getAdjacentTabId, openFileTab, saveFileViewerState, saveParkedFileViewerState, switchFileWorkspace } from "./file-tab-state.ts";

const tabA = {
  id: "file:/repo/a.ts",
  label: "a.ts",
  filePath: "/repo/a.ts",
  viewerRevision: 0,
  viewerState: {
    displayMode: "source",
    wrapLines: true,
    scrollTop: 240,
    scrollLeft: 16,
  },
};

const tabB = {
  id: "file:/repo/b.ts",
  label: "b.ts",
  filePath: "/repo/b.ts",
  viewerRevision: 0,
};

const openA = {
  cwd: "/repo",
  fileName: "a.ts",
  filePath: "/repo/a.ts",
  tabId: "file:/repo/a.ts",
};

test("saving viewer state updates only the matching revision", () => {
  const tabs = [tabA, tabB];
  const nextState = { ...tabA.viewerState, scrollTop: 480 };
  const saved = saveFileViewerState(tabs, tabA.id, 0, nextState);

  assert.notStrictEqual(saved, tabs);
  assert.deepEqual(saved[0].viewerState, nextState);
  assert.strictEqual(saved[1], tabB);

  const stale = saveFileViewerState(saved, tabA.id, 9, tabA.viewerState);
  assert.strictEqual(stale, saved);
});

test("opening an existing tab normally preserves its state and revision", () => {
  const tabs = [{ ...tabA, cwd: "/repo" }, tabB];
  assert.strictEqual(openFileTab(tabs, openA), tabs);
});

test("changing cwd remounts the viewer with the file's opening context", () => {
  const [next] = openFileTab([{ ...tabA, cwd: "/repo-worktrees/a" }], {
    ...openA,
    cwd: "/repo-worktrees/b",
  });
  assert.equal(next.cwd, "/repo-worktrees/b");
  assert.equal(next.viewerRevision, 1);
});

test("changing the source session remounts the viewer without losing its state", () => {
  const [next] = openFileTab([tabA], { ...openA, sourceSessionId: "session-2" });
  assert.equal(next.sourceSessionId, "session-2");
  assert.equal(next.viewerRevision, 1);
  assert.strictEqual(next.viewerState, tabA.viewerState);
});

test("opening from the same source session preserves the viewer revision", () => {
  const tab = { ...tabA, cwd: "/repo", sourceSessionId: "session-1" };
  const tabs = [tab];
  assert.strictEqual(
    openFileTab(tabs, { ...openA, sourceSessionId: "session-1" }),
    tabs,
  );
});

test("changing source while forcing diff increments the revision once", () => {
  const [next] = openFileTab([tabA], {
    ...openA,
    sourceSessionId: "session-2",
    modeHint: "diff",
  });
  assert.equal(next.sourceSessionId, "session-2");
  assert.equal(next.viewerRevision, 1);
  assert.equal(next.viewerState.displayMode, "diff");
});

test("every explicit diff activation resets the mode and increments the revision", () => {
  const first = openFileTab([tabA, tabB], { ...openA, modeHint: "diff" });
  assert.equal(first[0].viewerRevision, 1);
  assert.deepEqual(first[0].viewerState, {
    displayMode: "diff",
    wrapLines: true,
    scrollTop: 0,
    scrollLeft: 0,
    loadedBytes: undefined,
    scrollByMode: {
      diff: { scrollTop: 0, scrollLeft: 0 },
    },
  });

  const returnedToSource = saveFileViewerState(first, tabA.id, 1, tabA.viewerState);
  const second = openFileTab(returnedToSource, { ...openA, modeHint: "diff" });
  assert.equal(second[0].viewerRevision, 2);
  assert.equal(second[0].viewerState.displayMode, "diff");
});

test("a remounted viewer ignores the previous revision's late cleanup", () => {
  const reopened = openFileTab([tabA], { ...openA, modeHint: "diff" });
  const stale = saveFileViewerState(reopened, tabA.id, 0, tabA.viewerState);
  assert.strictEqual(stale, reopened);
  assert.equal(stale[0].viewerState.displayMode, "diff");
});

test("closing a tab selects its right neighbor, then its left neighbor", () => {
  const tabC = { ...tabA, id: "file:/repo/c.ts", filePath: "/repo/c.ts" };
  const tabs = [tabA, tabB, tabC];

  assert.equal(getAdjacentTabId(tabs, tabB.id), tabC.id);
  assert.equal(getAdjacentTabId(tabs, tabC.id), tabB.id);
  assert.equal(getAdjacentTabId([tabA], tabA.id), null);
});

test("opening a PDF again without a page fragment returns it to the first page", () => {
  const base = { tabId: "file:/repo/a.pdf", fileName: "a.pdf", filePath: "/repo/a.pdf" };
  const opened = openFileTab([], { ...base, page: 12 });
  assert.equal(opened[0].pdfPage, 12);

  // Plain open from the file tree: the tab must not stay stuck on page 12.
  const plain = openFileTab(opened, base);
  assert.equal(plain[0].pdfPage, undefined);
  assert.ok((plain[0].viewerRevision ?? 0) > (opened[0].viewerRevision ?? 0), "clearing the page must remount");

  // Re-opening on the same page is a no-op rather than a needless remount.
  const again = openFileTab(opened, { ...base, page: 12 });
  assert.equal(again, opened);
});

test("switching workspaces parks the left tabs and brings back the target's", () => {
  const states = new Map();
  const left = { tabs: [tabA], activeTabId: tabA.id, open: true };
  const arrived = switchFileWorkspace(states, "/proj-a", "/proj-b", left, 0);
  assert.deepEqual(arrived, { tabs: [], activeTabId: null, open: false });

  const back = switchFileWorkspace(states, "/proj-b", "/proj-a", arrived, 1);
  assert.deepEqual(back, { tabs: [tabA], activeTabId: tabA.id, open: true });
  assert.equal(states.has("/proj-a"), false, "live workspace is not kept in the parked map");
});

test("switching to the same workspace changes nothing", () => {
  const states = new Map();
  const current = { tabs: [tabA], activeTabId: tabA.id, open: true };
  assert.strictEqual(switchFileWorkspace(states, "/proj-a", "/proj-a", current, 0), current);
  assert.equal(states.size, 0);
});

test("a viewer report tagged with a left workspace's generation lands only there", () => {
  const states = new Map();
  // A is live under generation 0; switching to B (also showing tabA's path) bumps to 1.
  switchFileWorkspace(states, "/proj-a", "/proj-b", { tabs: [tabA], activeTabId: tabA.id, open: true }, 0);
  switchFileWorkspace(states, "/proj-b", "/proj-c", { tabs: [tabA], activeTabId: tabA.id, open: true }, 1);

  // A's viewer unmounts late, reporting generation 0: A's parked copy changes, B's does not.
  const scrolled = { ...tabA.viewerState, scrollTop: 480 };
  saveParkedFileViewerState(states, 0, tabA.id, 0, scrolled);
  assert.equal(states.get("/proj-a").tabs[0].viewerState.scrollTop, 480);
  assert.equal(states.get("/proj-b").tabs[0].viewerState.scrollTop, 240);
});

test("a parked report with a stale revision or an unknown generation is ignored", () => {
  const states = new Map();
  switchFileWorkspace(states, "/proj-a", "/proj-b", { tabs: [tabA], activeTabId: tabA.id, open: true }, 0);
  const before = states.get("/proj-a").tabs;

  saveParkedFileViewerState(states, 0, tabA.id, 9, { ...tabA.viewerState, scrollTop: 1 });
  assert.strictEqual(states.get("/proj-a").tabs, before);

  saveParkedFileViewerState(states, 7, tabA.id, 0, { ...tabA.viewerState, scrollTop: 1 });
  assert.strictEqual(states.get("/proj-a").tabs, before);
});
