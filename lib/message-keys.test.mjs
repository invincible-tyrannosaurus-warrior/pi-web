import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { carryMessageKeys, messageRenderKeys } = await jiti.import("./message-keys.ts");
const { mergeLoadedHistory } = await jiti.import("./chat-history-merge.ts");
const { partitionAssistantMessage } = await jiti.import("./message-display.ts");
const user = (content, timestamp = 1) => ({ role: "user", content, timestamp });
const assistant = (timestamp, content = [{ type: "text", text: "answer" }]) => ({ role: "assistant", timestamp, content });
const history = (messages, entryIds = [], aliases = new Map()) => ({ messages, entryIds, aliases });
const keys = (state) => messageRenderKeys(state.entryIds, state.messages.length, state.aliases);
const replace = (previous, next, adoptLive = true) => ({ ...next, aliases: carryMessageKeys(previous, next, adoptLive) });

test("the first run and subsequent runs keep prompt and response keys when ids arrive", () => {
  let live = history([user("hello"), assistant(2)]);
  let saved = replace(live, history([user("hello", 100), assistant(2)], ["u1", "a1"]));
  assert.deepEqual(keys(saved), keys(live));
  live = { ...saved, messages: [...saved.messages, user("next"), assistant(3)] };
  saved = replace(live, history(live.messages, ["u1", "a1", "u2", "a2"]));
  assert.deepEqual(keys(saved), keys(live));
  assert.equal(new Set(keys(saved)).size, 4);
  assert.deepEqual(keys(replace(saved, saved)), keys(saved));
});

test("identical prompts are matched by consecutive position, not a text search", () => {
  const messages = [user("repeat"), assistant(1), user("repeat"), assistant(2), user("repeat"), assistant(3)];
  const live = history(messages, ["u1", "a1"]);
  const saved = replace(live, history(messages, ["u1", "a1", "u2", "a2", "u3", "a3"]));
  assert.deepEqual(keys(saved), keys(live));
  assert.equal(new Set(keys(saved)).size, messages.length);

  const mismatch = replace(live, history([messages[0], messages[1], user("different"), ...messages.slice(3)], saved.entryIds));
  assert.deepEqual(keys(mismatch), saved.entryIds);
});

test("prompt attachments and custom content must agree, not only role or custom type", () => {
  const image = (data) => ({ type: "image", source: { type: "base64", media_type: "image/png", data } });
  const prompt = (data) => user([{ type: "text", text: "look" }, image(data)]);
  const custom = (content) => ({ role: "custom", customType: "notice", content, timestamp: 4 });
  const live = history([prompt("AAA"), custom("original")]);
  const saved = replace(live, history([prompt("AAA"), custom("original")], ["u", "c"]));
  assert.deepEqual(keys(saved), keys(live));
  assert.equal(replace(live, history([prompt("BBB"), custom("original")], ["u", "c"])).aliases.size, 0);
  assert.equal(replace(live, history([prompt("AAA"), custom("other")], ["u", "c"])).aliases.size, 1);
});

test("delivered prompt images keep their keys when the reader replaces bytes with lazy URLs", () => {
  const prompt = user([{ type: "text", text: "look" }, { type: "image", source: { type: "base64", data: "AAA", media_type: "image/png" } }], 7);
  const lazy = { ...prompt, content: [prompt.content[0], { type: "image", source: { type: "url", url: "/api/sessions/session/entries/u/tool-result-image?blockIndex=1", media_type: "image/png" } }] };
  const live = history([prompt]);
  assert.deepEqual(keys(replace(live, history([lazy], ["u"]))), keys(live));
  assert.equal(replace(live, history([{ ...lazy, timestamp: 8 }], ["u"])).aliases.size, 0);
  assert.equal(replace(live, history([lazy], ["other-u"])).aliases.size, 0);
  assert.equal(replace(live, history([lazy], ["u"]), false).aliases.size, 0);
});

test("a mismatch stops key transfer even if later messages match; missing timestamps are not identities", () => {
  const live = history([user("go"), assistant(2), assistant(3)]);
  const next = history([user("go"), assistant(99), assistant(3)], ["u", "a", "b"]);
  assert.deepEqual([...carryMessageKeys(live, next).keys()], ["u"]);
  assert.equal(carryMessageKeys(history([assistant(undefined)]), history([assistant(undefined)], ["a"])).size, 0);
  assert.equal(carryMessageKeys(history([assistant(1)]), history([user("go", 1)], ["u"])).size, 0);
});

test("prepending pages preserves live offsets and already adopted aliases", () => {
  const original = history([user("anchor"), user("go"), assistant(2)], ["anchor"]);
  const paged = history([user("older"), ...original.messages], ["older", ...original.entryIds]);
  assert.deepEqual(keys(paged).slice(1), keys(original));
  const saved = replace(paged, history(paged.messages, ["older", "anchor", "u", "a"]));
  assert.deepEqual(keys(saved), keys(paged));
  const next = history([user("oldest"), ...saved.messages], ["oldest", ...saved.entryIds]);
  assert.deepEqual(keys(replace(saved, next, false)).slice(1), keys(saved));
});

test("tail refresh carries keys AFTER merging already loaded older history", () => {
  const previous = { ...history([user("old"), user("anchor"), user("go"), assistant(2)], ["old", "anchor"]), oldestEntryId: "old", hasMore: true };
  const incoming = { ...history(previous.messages.slice(1), ["anchor", "u", "a"]), oldestEntryId: "anchor", hasMore: true };
  const merged = mergeLoadedHistory(previous, incoming);
  assert.deepEqual(merged.entryIds, ["old", "anchor", "u", "a"]);
  assert.deepEqual(keys(replace(previous, merged)), keys(previous));
});

test("branch replacement never adopts a sibling's identical prompt or response", () => {
  const messages = [user("common"), user("repeat"), assistant(2)];
  const live = history(messages, ["common"]);
  const sibling = history(messages, ["common", "other-u", "other-a"]);
  assert.deepEqual(keys(replace(live, sibling, false)), sibling.entryIds);

  const saved = replace(live, history(messages, ["common", "u", "a"]));
  const switched = replace(saved, sibling, false);
  assert.equal(switched.aliases.size, 0);
  assert.deepEqual(keys(switched), sibling.entryIds);
  assert.deepEqual(keys(replace(switched, saved, false)), saved.entryIds);
});

test("shared entries retain aliases during branch navigation, while sibling aliases are removed", () => {
  const live = history([user("common"), assistant(2)]);
  const saved = replace(live, history(live.messages, ["common", "a"]));
  const sibling = replace(saved, history([live.messages[0], assistant(3)], ["common", "b"]), false);
  assert.equal(keys(sibling)[0], keys(saved)[0]);
  assert.equal(keys(sibling)[1], "b");
  assert.equal(sibling.aliases.has("a"), false);
});

test("missing anchors fall back to entry ids instead of attaching state to the wrong tail", () => {
  const live = history([user("anchor"), user("repeat"), assistant(2)], ["anchor"]);
  const tail = history(live.messages.slice(1), ["u", "a"]);
  assert.deepEqual(keys(replace(live, tail)), tail.entryIds);
  const firstRun = history([user("repeat"), assistant(2)]);
  assert.deepEqual(keys(replace(firstRun, { ...tail, messages: [user("repeat"), assistant(2)], hasMore: true })), tail.entryIds);
});

test("split process and answer views keep distinct keys derived from the same stable message key", () => {
  const message = assistant(2, [{ type: "thinking", thinking: "plan" }, { type: "text", text: "answer" }]);
  const live = history([user("go"), message]);
  const saved = replace(live, history(live.messages, ["u", "a"]));
  const viewKeys = (state) => {
    const { processMessage, answerMessage } = partitionAssistantMessage(state.messages[1]);
    const key = keys(state)[1];
    return [processMessage && `process-${key}`, answerMessage && `message-${key}`];
  };
  assert.deepEqual(viewKeys(saved), viewKeys(live));
  assert.equal(new Set(viewKeys(saved)).size, 2);
});
