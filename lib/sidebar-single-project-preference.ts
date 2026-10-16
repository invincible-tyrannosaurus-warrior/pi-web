import { createBooleanPreference } from "./boolean-preference";

const preference = createBooleanPreference("pi-sidebar-single-project", false);

// Broadcast so the mounted sidebar switches layout when the setting changes.
export const SIDEBAR_SINGLE_PROJECT_EVENT = "pi-sidebar-single-project-changed";

export function isSidebarSingleProject(): boolean {
  return preference.get();
}

export function setSidebarSingleProject(enabled: boolean): void {
  preference.set(enabled);
  window.dispatchEvent(new Event(SIDEBAR_SINGLE_PROJECT_EVENT));
}
