import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { selectionFamilies, reconcileSessionSelection, toggleSessionSelection, sessionSelectionSummary, selectedArchiveIds } = await jiti.import("./session-selection.ts");
const { listSessionFamilies } = await jiti.import("./session-family.ts");

test("selection toggles, adds forward/reverse ranges, and never includes disabled or out-of-scope ids", () => {
  const eligible = ["a", "b", "d", "e"];
  let selected = toggleSessionSelection(new Set(["foreign", "running-c"]), eligible, "b", null, false);
  assert.deepEqual([...selected], ["b"]);
  selected = toggleSessionSelection(selected, eligible, "e", "b", true);
  assert.deepEqual([...selected], ["b", "d", "e"]);
  selected = toggleSessionSelection(selected, eligible, "a", "e", true);
  assert.deepEqual(new Set(selected), new Set(eligible));
  selected = toggleSessionSelection(selected, eligible, "d", "a", false);
  assert.equal(selected.has("d"), false);
  assert.deepEqual(toggleSessionSelection(selected, eligible, "running-c", "a", true), selected);
  assert.deepEqual([...toggleSessionSelection(new Set(), eligible, "e", "gone", true)], ["e"]);
});

test("a disappearing session is removed from stored picks and range anchor and does not reselect on return", () => {
  const selected = { projectKey: "/p", ids: new Set(["a", "b"]), anchor: "b" };
  const stable = reconcileSessionSelection(selected, ["a", "b"]);
  assert.equal(stable, selected, "unchanged eligibility does not rerender");
  const disappeared = reconcileSessionSelection(selected, ["a"]);
  assert.deepEqual([...disappeared.ids], ["a"]);
  assert.equal(disappeared.anchor, null);
  assert.equal(disappeared.projectKey, "/p");
  const returned = reconcileSessionSelection(disappeared, ["a", "b"]);
  assert.deepEqual([...returned.ids], ["a"]);
  assert.equal(returned.anchor, null);
});

test("select-all/none and partial checks yield the correct tri-state, ignoring stale picks", () => {
  assert.deepEqual(sessionSelectionSummary(new Set(), ["a", "b"]), { ids: [], all: false, indeterminate: false });
  assert.deepEqual(sessionSelectionSummary(new Set(["a", "foreign"]), ["a", "b"]), { ids: ["a"], all: false, indeterminate: true });
  assert.deepEqual(sessionSelectionSummary(new Set(["a", "b"]), ["a", "b"]), { ids: ["a", "b"], all: true, indeterminate: false });
  assert.deepEqual(sessionSelectionSummary(new Set(["gone"]), []), { ids: [], all: false, indeterminate: false });
});

const sessions = [
  { id: "root", cwd: "/p", modified: "2026-01-01" },
  { id: "fork", cwd: "/p", parentSessionId: "root", relation: { kind: "fork", originSessionId: "root" }, modified: "2026-01-02" },
  { id: "subagent", cwd: "/other", relation: { kind: "subagent", parentSessionId: "root" }, modified: "2026-01-01" },
  { id: "archived", cwd: "/p", modified: "2026-01-01" },
  { id: "foreign", cwd: "/other", modified: "2026-01-01" },
];
const families = listSessionFamilies(sessions);

test("scope contains all current-view families of exactly one project, even cross-project subagents", () => {
  const archived = { archived: "2026-02-01" };
  const normal = selectionFamilies(families, "/p", false, archived, new Set());
  assert.deepEqual(new Set(normal.map((f) => f.root.id)), new Set(["root", "fork"]));
  assert.deepEqual(normal.find((f) => f.root.id === "root").subagents.map((s) => s.id), ["subagent"]);
  assert.deepEqual(selectionFamilies(families, "/p", true, archived, new Set()).map((f) => f.root.id), ["archived"]);
  assert.deepEqual(selectionFamilies(families, "/missing", false, archived, new Set()), []);
  assert.deepEqual(selectionFamilies(families, "/p", true, archived, new Set(["archived"])), []);
});

test("archive mapping deduplicates subagents onto roots, while forks remain independent families", () => {
  assert.deepEqual(selectedArchiveIds(families, new Set(["subagent", "root"])), ["root"]);
  assert.deepEqual(selectedArchiveIds(families, new Set(["fork"])), ["fork"]);
  assert.deepEqual(new Set(selectedArchiveIds(families, new Set(["root", "fork"]))), new Set(["root", "fork"]));
  assert.deepEqual(selectedArchiveIds(families, new Set(["unknown"])), []);
});
