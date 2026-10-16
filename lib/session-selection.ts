import type { SessionFamily } from "./session-family";
import { isFamilyArchived } from "./session-family";
import { workspaceKeyOf } from "./workspace-key";

export function selectionFamilies(
  families: readonly SessionFamily[], projectKey: string, archiveView: boolean,
  archived: Readonly<Record<string, string>>, runningIds: ReadonlySet<string>,
): SessionFamily[] {
  return families.filter((family) => workspaceKeyOf(family.root) === projectKey
    && isFamilyArchived(family, archived, runningIds) === archiveView);
}

/** Range follows displayed order, excludes disabled rows, and keeps earlier picks. */
export function toggleSessionSelection(
  selected: ReadonlySet<string>, orderedIds: readonly string[], id: string, anchor: string | null, range: boolean,
): Set<string> {
  const eligible = new Set(orderedIds);
  const next = new Set([...selected].filter((value) => eligible.has(value)));
  const end = orderedIds.indexOf(id);
  if (end < 0) return next;
  const start = anchor === null ? -1 : orderedIds.indexOf(anchor);
  if (range && start >= 0) {
    for (const value of orderedIds.slice(Math.min(start, end), Math.max(start, end) + 1)) next.add(value);
  } else if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function reconcileSessionSelection<T extends { ids: Set<string>; anchor: string | null }>(
  selection: T, eligibleIds: readonly string[],
): T {
  const eligible = new Set(eligibleIds);
  const ids = new Set([...selection.ids].filter((id) => eligible.has(id)));
  const anchor = selection.anchor !== null && eligible.has(selection.anchor) ? selection.anchor : null;
  return ids.size === selection.ids.size && anchor === selection.anchor ? selection : { ...selection, ids, anchor };
}

export function sessionSelectionSummary(selected: ReadonlySet<string>, eligibleIds: readonly string[]) {
  const ids = eligibleIds.filter((id) => selected.has(id));
  return { ids, all: ids.length > 0 && ids.length === eligibleIds.length, indeterminate: ids.length > 0 && ids.length < eligibleIds.length };
}
