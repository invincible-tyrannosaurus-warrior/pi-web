import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

function fileContentBlock() {
  const start = source.indexOf("{/* The active viewer plus a few recent");
  const end = source.indexOf("</div>\n      </div>\n    </div>", start);
  assert.notEqual(start, -1, "file content comment not found");
  assert.notEqual(end, -1, "end of file content block not found");
  return source.slice(start, end);
}

test("recent file tabs stay mounted but hidden, capped", () => {
  const block = fileContentBlock();
  assert.match(source, /const MOUNTED_FILE_VIEWERS = 3;/);
  assert.match(source, /\[activeFileTabId, \.\.\.recentFileTabIdsRef\.current\][\s\S]*?\.slice\(0, MOUNTED_FILE_VIEWERS\)/);
  assert.match(block, /fileTabs\.map\(/);
  assert.match(block, /!mountedFileTabIds\.has\(tab\.id\)/);
  assert.match(block, /inert=\{active \? undefined : true\}/);
  assert.match(block, /visibility: "hidden", contentVisibility: "hidden"/);
  assert.equal(block.match(/<FileViewer/g)?.length, 1);
});

test("each viewer restores tab state and saves it with a revision", () => {
  const block = fileContentBlock();
  assert.match(block, /key=\{`\$\{tab\.id\}:\$\{tab\.viewerRevision \?\? 0\}`\}/);
  assert.match(block, /cwd=\{tab\.cwd \?\? activeCwd \?\? undefined\}/);
  assert.match(block, /initialState=\{tab\.viewerState\}/);
  assert.match(block, /handleFileViewerStateChange\(\s*tab\.id,\s*tab\.viewerRevision \?\? 0,/);
  assert.match(block, /onMentionLines=\{rightPanelOpen && active \? handleFileLineMention : undefined\}/);
});

test("a project switch leaves the file tabs alone", () => {
  const start = source.indexOf("const handleCwdChange = useCallback(");
  const body = source.slice(start, source.indexOf("const handleSelectSession = useCallback(", start));
  assert.doesNotMatch(body, /setFileTabs|setActiveFileTabId|FileWorkspace/);
});

test("choosing a chat leaves the file tabs alone", () => {
  const start = source.indexOf("const handleSelectSession = useCallback(");
  const body = source.slice(start, source.indexOf("const handleNewSession = useCallback(", start));
  assert.doesNotMatch(body, /changeFileWorkspace|setFileTabs|setActiveFileTabId|setRightPanelOpen/);
});

test("file mentions carry their source cwd into the focused chat", () => {
  assert.match(source, /function pathForChatMention/);
  assert.match(source, /pathForChatMention\(relativePath, sourceCwd, getFocusedChatCwd\(\)\)/);
  assert.match(source, /source === target[\s\S]*return joinFilePath\(sourceCwd, path\)/);
});

test("closing the file panel pauses the active viewer watcher", () => {
  assert.match(source, /watchEnabled=\{fileWatchEnabled && active\}/);
  assert.match(source, /setFileWatchEnabled\(false\)/);
  assert.match(source, /addEventListener\("transitionend", onTransitionEnd\)/);
});

test("a closed file panel is removed from keyboard and accessibility navigation", () => {
  assert.match(source, /aria-hidden=\{!rightPanelOpen\}/);
  assert.match(source, /inert=\{!rightPanelOpen \? true : undefined\}/);
});

test("the file panel restores focus to its actual toolbar toggle", () => {
  const toggleStart = source.indexOf("const renderMainFileToggle");
  const toggleEnd = source.indexOf("\n  };", toggleStart);
  assert.notEqual(toggleStart, -1);
  assert.match(source.slice(toggleStart, toggleEnd), /ref=\{filePanelToggleRef\}/);
});

test("the open file panel does not duplicate or depress the header toggle", async () => {
  const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const toggleStart = source.indexOf("const renderMainFileToggle");
  const toggleEnd = source.indexOf("\n  };", toggleStart);
  const fileToggle = source.slice(toggleStart, toggleEnd);
  assert.doesNotMatch(fileToggle, /background: rightPanelOpen/);
  assert.doesNotMatch(fileToggle, /color: rightPanelOpen/);
  assert.match(source, /className="workspace-header-action right-panel-header-close"/);
  assert.match(cssSource, /\.right-panel-header-close \{\s*display: flex;/);
  assert.match(
    cssSource,
    /@media \(min-width: 960px\)[\s\S]*?\.right-panel-header-close \{\s*display: none;/,
  );
});
