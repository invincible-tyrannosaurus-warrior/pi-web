import { createBooleanPreference } from "./boolean-preference";

const preference = createBooleanPreference("pi-auto-session-title", true);

export function isAutoSessionTitleEnabled(): boolean {
  return preference.get();
}

export function setAutoSessionTitleEnabled(enabled: boolean): void {
  preference.set(enabled);
}
