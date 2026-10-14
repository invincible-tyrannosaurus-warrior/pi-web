import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useResizablePanel.ts", import.meta.url), "utf8");
const restore = source.slice(
  source.indexOf("useLayoutEffect(() => {"),
  source.indexOf("}, [commitWidth, defaultWidth, getDefaultWidth, storageKey]);"),
);

test("stored panel width is applied before paint without running CSS width transitions", () => {
  assert.match(restore, /panel\.style\.transition = "none"/);
  assert.match(restore, /commitWidth\(candidate, \{ persist: false \}\)/);
  assert.match(restore, /void panel\.offsetWidth/);
  assert.match(restore, /panel\.style\.transition = previousTransition/);
  assert.ok(restore.indexOf("transition = \"none\"") < restore.indexOf("commitWidth(candidate"));
  assert.ok(restore.indexOf("commitWidth(candidate") < restore.indexOf("void panel.offsetWidth"));
});

test("panel drags never set React state per pointer move", async () => {
  // The chat panes observer fires on every drag frame: storing the raw width in state re-rendered the whole app.
  const shell = await readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(shell, /setChatPanesWidth/);
  // Crossing the split threshold mid-drag re-rendered the app; it settles on the resize-end event.
  assert.match(shell, /chatPanesWidthRef\.current = width;[\s\S]{0,160}if \(!isPanelResizing\(\)\) setChatPanesWide\(width >= CHAT_SPLIT_MIN_WIDTH\);/);
  assert.match(shell, /window\.addEventListener\(PANEL_RESIZE_END_EVENT, onResizeEnd\)/);
  const move = source.slice(source.indexOf("const onPointerMove ="), source.indexOf("const onPointerUp ="));
  assert.match(move, /applyLiveWidth\(nextWidth\)/);
  assert.doesNotMatch(move, /setWidth\(|commitWidth\(/);
  const finish = source.slice(source.indexOf("const finishResize ="), source.indexOf("const onPointerDown ="));
  assert.match(finish, /restoreBodyState\(drag\)/);
  // Grab and release toggle DOM classes instead of React state (a state flip re-rendered the whole app).
  assert.doesNotMatch(source, /setIsResizing/);
  assert.match(source, /target\.classList\.toggle\("is-resizing", resizing\)/);
  // Release writes the DOM and storage only: a setWidth there re-rendered the whole app after every drag.
  assert.doesNotMatch(finish, /setWidth\(|commitWidth\(/);
  assert.match(finish, /settleWidth\(finalWidth\);/);
  assert.match(finish, /writeStoredWidth\(storageKey, finalWidth\);/);
  // --panel-transition is inherited: set it once on release, never per move.
  assert.doesNotMatch(move, /--panel-transition/);
  assert.match(source, /window\.dispatchEvent\(new Event\(PANEL_RESIZE_END_EVENT\)\)/);
});

test("drag frames skip the minimap and the chat's mask", async () => {
  const minimap = await readFile(new URL("../components/ChatMinimap.tsx", import.meta.url), "utf8");
  assert.match(minimap, /frame = 0;\s*\/\/[^\n]*\n\s*if \(isPanelResizing\(\)\) return;/);
  assert.match(minimap, /window\.addEventListener\(PANEL_RESIZE_END_EVENT, invalidate\)/);
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /html\[data-panel-resizing\] \.chat-scroll-fade \{ mask-image: none; \}/);
});

test("the live panel width variable stops at the panel's direct children", async () => {
  // An inherited custom property change restyles every descendant; large previews made each drag frame cost ~30 ms.
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.sidebar-container > \* > \*,\s*\.right-panel-container > \* > \* \{\s*--sidebar-width: initial;\s*--right-panel-width: initial;/);
});
