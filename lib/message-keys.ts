import type { AgentMessage } from "./types";
import { userMessageKey } from "./prompt-recovery";

interface MessageHistory {
  messages: readonly AgentMessage[];
  entryIds: readonly string[];
  hasMore?: boolean;
}

const liveKey = (anchor: string | undefined, offset: number) => `live:${anchor ?? ""}:${offset}`;

/** Appends and prepended pages leave a live message's position after its saved anchor alone. */
export function messageRenderKeys(
  entryIds: readonly string[],
  count: number,
  aliases: ReadonlyMap<string, string>,
): string[] {
  const anchor = entryIds[entryIds.length - 1];
  return Array.from({ length: count }, (_, index) => {
    const id = entryIds[index];
    return id === undefined ? liveKey(anchor, index - entryIds.length) : aliases.get(id) ?? id;
  });
}

function matchesLiveMessage(live: AgentMessage, saved: AgentMessage, entryId: string): boolean {
  if (live.role !== saved.role) return false;
  // Optimistic prompts use a browser timestamp; compare text AND attachments instead.
  if (live.role === "user" && saved.role === "user") {
    if (userMessageKey(live) === userMessageKey(saved)) return true;
    // Our reader replaces saved image bytes with an entry-specific lazy URL. Only
    // a delivered prompt's matching timestamp can vouch for those missing bytes.
    if (typeof live.timestamp !== "number" || live.timestamp !== saved.timestamp
      || !Array.isArray(live.content) || !Array.isArray(saved.content)) return false;
    const liveContent = live.content;
    const content = saved.content.map((block, index) => {
      const original = liveContent[index];
      return block.type === "image" && original?.type === "image"
        && block.source?.type === "url"
        && block.source.url?.endsWith(`/entries/${encodeURIComponent(entryId)}/tool-result-image?blockIndex=${index}`)
        ? original : block;
    });
    return userMessageKey(live) === userMessageKey({ ...saved, content });
  }
  if (live.role === "custom" && saved.role === "custom") {
    return live.customType === saved.customType && userMessageKey(live) === userMessageKey(saved);
  }
  return typeof live.timestamp === "number" && live.timestamp === saved.timestamp;
}

/** Transfer live keys to newly persisted ids, only at consecutive positions on the same branch. */
export function carryMessageKeys(
  previous: MessageHistory & { aliases: ReadonlyMap<string, string> },
  next: MessageHistory,
  adoptLive = true,
): Map<string, string> {
  const nextIds = new Set(next.entryIds);
  const aliases = new Map([...previous.aliases].filter(([id]) => nextIds.has(id)));
  // A branch replacement can have an identical prompt after the same ancestor.
  if (!adoptLive) return aliases;
  const liveStart = previous.entryIds.length;
  const anchor = previous.entryIds[liveStart - 1];
  const anchorIndex = anchor === undefined ? -1 : next.entryIds.indexOf(anchor);
  // shortcut: a run whose anchor is outside the refreshed page remounts; add overlap recovery if needed.
  if ((anchor !== undefined && anchorIndex === -1) || (anchor === undefined && next.hasMore)) return aliases;
  for (let index = liveStart; index < previous.messages.length; index++) {
    const offset = index - liveStart;
    const nextIndex = anchorIndex + 1 + offset;
    const id = next.entryIds[nextIndex];
    const saved = next.messages[nextIndex];
    if (id === undefined || !saved || !matchesLiveMessage(previous.messages[index], saved, id)) break;
    aliases.set(id, liveKey(anchor, offset));
  }
  return aliases;
}
