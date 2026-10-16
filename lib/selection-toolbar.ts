// Where the floating selection toolbar ("Quote" / "Side chat") goes, shared by
// the chat and the file viewer: anchored to where the selection starts, above it, so its
// place does not depend on how many lines were selected.

export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface SelectionAnchor {
  /** Horizontal center of the selected part of the first line. */
  x: number;
  /** Top of the first selected line. */
  top: number;
  /** Bottom of the last selected line. */
  bottom: number;
}

export type ToolbarSide = "above" | "below";

const GAP = 6;
const MARGIN = 8;

type RectLike = Pick<DOMRect, "top" | "bottom" | "left" | "right" | "width" | "height">;

/** Anchor from the selection's line boxes: first line for x/top, whole range for bottom. */
export function anchorFromRects(rects: ArrayLike<RectLike>, bounding: RectLike): SelectionAnchor | null {
  const first = Array.from(rects).find((rect) => rect.width > 0 && rect.height > 0);
  if (!first || bounding.height <= 0) return null;
  // One line: the bounding box is the selected words. Several: the first line runs from
  // where the selection starts to the line end, which the bounding box's right edge marks.
  const singleLine = bounding.bottom - first.top < first.height * 1.5;
  const right = singleLine ? bounding.right : Math.max(first.right, bounding.right);
  const left = singleLine ? bounding.left : first.left;
  return { x: (left + right) / 2, top: first.top, bottom: bounding.bottom };
}

export function selectionAnchor(range: Range): SelectionAnchor | null {
  return anchorFromRects(range.getClientRects(), range.getBoundingClientRect());
}

/**
 * Places a toolbar of `size` inside `bounds` (the visible scroller, already clipped to the
 * viewport). `side` keeps an earlier choice, so a toolbar that grows (the inline composer)
 * extends away from the text instead of flipping over it.
 */
export function placeSelectionToolbar(
  anchor: SelectionAnchor,
  size: { width: number; height: number },
  bounds: Box,
  options: { preferBelow?: boolean; side?: ToolbarSide } = {},
): { top: number; left: number; side: ToolbarSide } {
  const roomAbove = anchor.top - GAP - size.height >= bounds.top + MARGIN;
  const roomBelow = anchor.bottom + GAP + size.height <= bounds.bottom - MARGIN;
  const side = options.side
    ?? (options.preferBelow ? (roomBelow || !roomAbove ? "below" : "above") : (roomAbove || !roomBelow ? "above" : "below"));
  const wanted = side === "above" ? anchor.top - GAP - size.height : anchor.bottom + GAP;
  const top = clamp(wanted, bounds.top + MARGIN, bounds.bottom - MARGIN - size.height);
  const left = clamp(anchor.x - size.width / 2, bounds.left + MARGIN, bounds.right - MARGIN - size.width);
  return { top, left, side };
}

/** `outer` clipped to the visual viewport (pinch zoom, on-screen keyboard). */
export function visibleBounds(outer: Box | null): Box {
  const viewport = typeof window === "undefined" ? null : window.visualViewport;
  const top = viewport?.offsetTop ?? 0;
  const left = viewport?.offsetLeft ?? 0;
  const view = {
    top,
    left,
    bottom: top + (viewport?.height ?? window.innerHeight),
    right: left + (viewport?.width ?? window.innerWidth),
  };
  if (!outer) return view;
  return {
    top: Math.max(view.top, outer.top),
    left: Math.max(view.left, outer.left),
    bottom: Math.min(view.bottom, outer.bottom),
    right: Math.min(view.right, outer.right),
  };
}

// Too-small bounds: keep the start edge visible (top/left wins over bottom/right).
function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

/** Touch puts the system copy menu above a selection; our toolbar goes below it there. */
export function prefersToolbarBelow(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}
