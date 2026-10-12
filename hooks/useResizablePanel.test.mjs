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

test("file preview keeps the committed width while pointer moves resize the panel", async () => {
  const shell = await readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(shell, /"--right-panel-preview-width": `\$\{rightPanelResizer\.width\}px`/);
  assert.match(css, /\.right-panel-container\.right-panel-resizing > \.file-preview-pane\s*\{\s*width: var\(--right-panel-preview-width\);/);
  const move = source.slice(source.indexOf("const onPointerMove ="), source.indexOf("const onPointerUp ="));
  assert.match(move, /applyLiveWidth\(nextWidth\)/);
  assert.doesNotMatch(move, /setWidth\(|commitWidth\(/);
  const finish = source.slice(source.indexOf("const finishResize ="), source.indexOf("const onPointerDown ="));
  assert.match(finish, /setIsResizing\(false\)/);
  assert.match(finish, /commitWidth\(widthRef\.current/);
});
