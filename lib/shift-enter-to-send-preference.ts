import { createBooleanPreference } from "./boolean-preference";

const preference = createBooleanPreference("pi-shift-enter-to-send", false);

export function isShiftEnterToSend(): boolean {
  return preference.get();
}

export function setShiftEnterToSend(enabled: boolean): void {
  preference.set(enabled);
}
