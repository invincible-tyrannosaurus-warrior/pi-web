import { createBooleanPreference } from "./boolean-preference";

const preference = createBooleanPreference("pi-thinking-expanded", false);

// Broadcast so already-mounted ThinkingBlock instances update when the
// preference changes in the settings panel.
export const THINKING_EXPANDED_EVENT = "pi-thinking-expanded-changed";

export function isThinkingExpandedByDefault(): boolean {
  return preference.get();
}

export function setThinkingExpandedByDefault(expanded: boolean): void {
  preference.set(expanded);
  window.dispatchEvent(new Event(THINKING_EXPANDED_EVENT));
}
