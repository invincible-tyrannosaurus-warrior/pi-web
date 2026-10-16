/**
 * A boolean browser preference that survives blocked or full storage: a value that could
 * not be saved still applies for this page, so a settings switch and the behavior agree.
 */
export function createBooleanPreference(key: string, defaultValue: boolean) {
  let unsaved: boolean | undefined;
  return {
    get(): boolean {
      if (typeof window === "undefined") return defaultValue;
      if (unsaved !== undefined) return unsaved;
      try {
        const stored = window.localStorage.getItem(key);
        return stored === null ? defaultValue : stored === "true";
      } catch {
        return defaultValue;
      }
    },
    set(value: boolean): void {
      try {
        window.localStorage.setItem(key, String(value));
        unsaved = undefined;
      } catch {
        unsaved = value;
      }
    },
  };
}
