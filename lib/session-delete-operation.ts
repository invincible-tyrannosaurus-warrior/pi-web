import { NextResponse } from "next/server";
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync, type Stats } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { commitSessionDeletes, readSessionFileRecord, reparentSessionRecord, type SessionFileRecord } from "./session-delete";
import { resolveSessionPath, readSessionHeader, invalidateSessionPathCache, invalidateSessionListCache } from "./session-reader";
import { getRpcSession, reserveRpcSessionFileMutation } from "./rpc-manager";
import { isPathWithinRoots } from "./path-security";
import { sessionPathKey } from "./session-path";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { removeSidebarSessions, SESSION_ID_PATTERN } from "./sidebar-state";

class DeleteRefusal extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
interface DeleteFile {
  path: string;
  pathKey: string;
  id: string;
  parentPath?: string;
  fingerprint: string;
}
interface DeleteDirectory {
  files: Map<string, DeleteFile>;
  children: Map<string, Set<DeleteFile>>;
  fingerprint: string;
}

/** Request-local, header-only relation catalogue. Each target directory is scanned once. */
export function createSessionDeleteIndex() { return new Map<string, DeleteDirectory>(); }

function fingerprint(stat: Stats): string {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}

/** Check cached/runtime paths too; never follow a session-directory symlink outside the real root. */
function checkedFile(path: string, expectedId?: string, allowMissing = false): DeleteFile | null {
  const roots = new Set([realpathSync(join(getAgentDir(), "sessions"))]);
  if (!path.endsWith(".jsonl") || !isPathWithinRoots(realpathSync(dirname(path)), roots)) {
    throw new DeleteRefusal(403, "Session path is outside the sessions root or is not a JSONL file");
  }
  let stat;
  try { stat = lstatSync(path); }
  catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const realPath = realpathSync(path);
  if (!stat.isFile() || !isPathWithinRoots(realPath, roots)) {
    throw new DeleteRefusal(403, "Session path is not a regular file inside the sessions root");
  }
  const header = readSessionHeader(realPath);
  if (!header || typeof header.id !== "string" || (expectedId !== undefined && header.id !== expectedId)) {
    throw new DeleteRefusal(409, "Session changed while preparing deletion");
  }
  return { path: realPath, pathKey: sessionPathKey(realPath), id: header.id,
    parentPath: typeof header.parentSession === "string" ? header.parentSession : undefined, fingerprint: fingerprint(stat) };
}

function setIndexedFile(directory: DeleteDirectory, file: DeleteFile, previous?: DeleteFile) {
  if (previous?.parentPath) directory.children.get(sessionPathKey(previous.parentPath))?.delete(previous);
  directory.files.set(file.pathKey, file);
  if (file.parentPath) {
    const key = sessionPathKey(file.parentPath);
    const children = directory.children.get(key) ?? new Set<DeleteFile>();
    children.add(file);
    directory.children.set(key, children);
  }
}

// shortcut: inherited same-directory child discovery; extend single and bulk together when cross-cwd orphan handling is addressed.
function directoryIndex(path: string, index: ReturnType<typeof createSessionDeleteIndex>): DeleteDirectory {
  const dir = dirname(path);
  const cached = index.get(dir);
  if (cached) return cached;
  const directory: DeleteDirectory = { files: new Map(), children: new Map(), fingerprint: fingerprint(statSync(dir)) };
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    try {
      const file = checkedFile(join(dir, name));
      if (file) setIndexedFile(directory, file);
    } catch (error) {
      if (!(error instanceof DeleteRefusal)) throw error;
      // An unrelated invalid/symlinked file is never a mutation candidate.
    }
  }
  if (directory.fingerprint !== fingerprint(statSync(dir))) throw new DeleteRefusal(409, "Session directory changed while preparing deletion");
  index.set(dir, directory);
  return directory;
}

/** Shared single/bulk deletion. Bulk never cascades into unselected sessions. */
export async function deleteSessionById(id: string, exact = false, index = createSessionDeleteIndex()) {
  if (!SESSION_ID_PATTERN.test(id) || id.length > 256) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }
  try {
    if (getRpcSession(id)?.isRunning?.()) throw new DeleteRefusal(409, "Session is running");
    let filePath = await resolveSessionPath(id);
    const runtime = getRpcSession(id);
    let target = filePath ? checkedFile(filePath, id, true) : null;
    if (!target && runtime?.sessionFile && runtime.sessionFile !== filePath) {
      filePath = runtime.sessionFile;
      target = checkedFile(filePath, id, true);
    }
    if (!target) {
      if (!runtime) {
        invalidateSessionPathCache(id);
        throw new DeleteRefusal(404, "Session not found");
      }
      const release = await reserveRpcSessionFileMutation([id]);
      if (!release) throw new DeleteRefusal(409, "Session is busy");
      try {
        // Shutdown can flush an unsaved runtime. Preserve a newly saved file and require a fresh plan.
        if (filePath && checkedFile(filePath, id, true)) throw new DeleteRefusal(409, "Session was saved while preparing deletion; retry");
        return await finishDeletion([id]);
      } finally { release(); }
    }

    const directory = directoryIndex(target.path, index);
    const indexedTarget = directory.files.get(target.pathKey);
    if (!indexedTarget || indexedTarget.id !== id || indexedTarget.fingerprint !== target.fingerprint) {
      throw new DeleteRefusal(409, "Session changed while preparing deletion");
    }
    target = indexedTarget;
    const parentSessionPath = target.parentPath;
    const parentSessionId = parentSessionPath ? checkedFile(parentSessionPath, undefined, true)?.id : undefined;
    const directChildren = [...(directory.children.get(target.pathKey) ?? [])];
    const bodies = new Map<string, SessionFileRecord>();
    const readBody = (file: DeleteFile) => {
      const cached = bodies.get(file.pathKey);
      if (cached) return cached;
      if (checkedFile(file.path, file.id)?.fingerprint !== file.fingerprint) throw new DeleteRefusal(409, "Session changed while preparing deletion");
      const record = readSessionFileRecord(file.path);
      if (!record || record.id !== file.id) throw new DeleteRefusal(409, "Session changed while preparing deletion");
      bodies.set(file.pathKey, record);
      return record;
    };
    const cascadeDeletes = new Set<DeleteFile>();
    if (!exact && !parentSessionPath) {
      const queue = directChildren.filter((file) => readBody(file).isSubagent);
      while (queue.length) {
        const file = queue.shift()!;
        if (cascadeDeletes.has(file)) continue;
        cascadeDeletes.add(file);
        queue.push(...(directory.children.get(file.pathKey) ?? []));
      }
    }
    const reparents = directChildren.filter((file) => !cascadeDeletes.has(file)).map(readBody);
    if (reparents.some((record) => record.isSubagent) && parentSessionPath && !parentSessionId) {
      throw new DeleteRefusal(409, "Cannot reparent subagent session");
    }
    const affected = [target, ...cascadeDeletes, ...directChildren.filter((file) => !cascadeDeletes.has(file))];
    const release = await reserveRpcSessionFileMutation(affected.map((file) => file.id));
    if (!release) throw new DeleteRefusal(409, "Session is busy");
    try {
      if (directory.fingerprint !== fingerprint(statSync(dirname(target.path))) || affected.some((file) =>
        checkedFile(file.path, file.id)?.fingerprint !== file.fingerprint)
        || reparents.some((record) => readFileSync(record.path, "utf8") !== record.original)) {
        throw new DeleteRefusal(409, "Session changed while preparing deletion");
      }
      const rewrites = reparents.map((record) => ({
        record, updated: reparentSessionRecord(record, parentSessionPath, parentSessionId, exact),
      }));
      const applied: SessionFileRecord[] = [];
      try {
        for (const { record, updated } of rewrites) {
          writePrivateFileAtomicSync(record.path, updated);
          applied.push(record);
        }
        commitSessionDeletes([target.path, ...[...cascadeDeletes].map((file) => file.path)]);
      } catch (error) {
        for (const record of applied.reverse()) {
          try { writePrivateFileAtomicSync(record.path, record.original); } catch { /* preserve original error */ }
        }
        throw error;
      }
      for (const record of reparents) {
        const previous = directory.files.get(record.pathKey);
        setIndexedFile(directory, checkedFile(record.path, record.id)!, previous);
      }
      const deleted = [target, ...cascadeDeletes];
      for (const file of deleted) {
        directory.files.delete(file.pathKey);
        if (file.parentPath) directory.children.get(sessionPathKey(file.parentPath))?.delete(file);
        directory.children.delete(file.pathKey);
      }
      directory.fingerprint = fingerprint(statSync(dirname(target.path)));
      return await finishDeletion(deleted.map((file) => file.id));
    } finally { release(); }
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: error instanceof DeleteRefusal ? error.status : 500 });
  }
}

async function finishDeletion(deletedSessionIds: string[]) {
  for (const id of deletedSessionIds) invalidateSessionPathCache(id);
  // A cleanup error must not disguise committed deletes: clients still close their tabs.
  let warning: string | undefined;
  try { await removeSidebarSessions(deletedSessionIds); }
  catch (error) { warning = String(error); }
  invalidateSessionListCache();
  return NextResponse.json({ ok: true, deletedSessionIds, ...(warning ? { warning } : {}) });
}
