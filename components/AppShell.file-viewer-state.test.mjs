import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

function fileContentBlock() {
  const start = source.indexOf("{/* Only the active viewer");
  const end = source.indexOf("</div>\n      </div>\n    </div>", start);
  assert.notEqual(start, -1, "file content comment not found");
  assert.notEqual(end, -1, "end of file content block not found");
  return source.slice(start, end);
}

test("only the active file tab mounts a FileViewer", () => {
  const block = fileContentBlock();
  assert.match(block, /activeFileTab\?\.filePath \? \(/);
  assert.doesNotMatch(block, /fileTabs\.map\(/);
  assert.equal(block.match(/<FileViewer/g)?.length, 1);
});

test("the active viewer restores tab state and saves it with a revision", () => {
  const block = fileContentBlock();
  assert.match(block, /key=\{`\$\{fileWorkspaceGeneration\}:\$\{activeFileTab\.id\}:\$\{activeFileTab\.viewerRevision \?\? 0\}`\}/);
  assert.match(block, /cwd=\{activeFileTab\.cwd \?\? activeCwd \?\? undefined\}/);
  assert.match(block, /initialState=\{activeFileTab\.viewerState\}/);
  assert.match(block, /handleFileViewerStateChange\(\s*fileWorkspaceGeneration,\s*activeFileTab\.id,\s*activeFileTab\.viewerRevision \?\? 0,/);
  assert.match(block, /onMentionLines=\{rightPanelOpen \? handleFileLineMention : undefined\}/);
});

test("a project switch parks the file tabs and brings back the target's", () => {
  const start = source.indexOf("const handleCwdChange = useCallback(");
  const body = source.slice(start, source.indexOf("const handleSelectSession = useCallback(", start));
  assert.match(body, /changeFileWorkspace\(currentProject, newProject\)/);
  assert.doesNotMatch(body, /setFileTabs\(\[\]\)/);
});

test("choosing a chat leaves the file tabs alone", () => {
  const start = source.indexOf("const handleSelectSession = useCallback(");
  const body = source.slice(start, source.indexOf("const handleNewSession = useCallback(", start));
  assert.doesNotMatch(body, /changeFileWorkspace|setFileTabs|setActiveFileTabId|setRightPanelOpen/);
});

test("a viewer report from a workspace just left is parked, not applied to live tabs", () => {
  assert.match(source, /if \(generation !== fileWorkspaceGenerationRef\.current\) \{\s*saveParkedFileViewerState\(/);
  const changeStart = source.indexOf("const changeFileWorkspace = useCallback(");
  const changeBody = source.slice(changeStart, source.indexOf("}, [activeFileTabId, fileTabs, rightPanelOpen]);", changeStart));
  assert.doesNotMatch(changeBody, /setTerminalTabs/);
});

test("file mentions carry their source cwd into the focused chat", () => {
  assert.match(source, /function pathForChatMention/);
  assert.match(source, /pathForChatMention\(relativePath, sourceCwd, getFocusedChatCwd\(\)\)/);
  assert.match(source, /source === target[\s\S]*return joinFilePath\(sourceCwd, path\)/);
});

test("closing the file panel pauses the active viewer watcher", () => {
  assert.match(source, /watchEnabled=\{fileWatchEnabled\}/);
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
