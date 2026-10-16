import type { ITheme } from "@xterm/xterm";

export const TERMINAL_LIGHT_STORAGE_KEY = "pi-web:terminal-light";
export const TERMINAL_THEME_EVENT = "pi-terminal-theme-changed";
let unsaved: boolean | undefined;

// Same blocked-storage fallback as lib/boolean-preference.ts, shared by all panels.
export function isTerminalLight(): boolean {
  if (typeof window === "undefined") return false;
  if (unsaved !== undefined) return unsaved;
  try {
    return window.localStorage.getItem(TERMINAL_LIGHT_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setTerminalLight(light: boolean): void {
  try {
    window.localStorage.setItem(TERMINAL_LIGHT_STORAGE_KEY, String(light));
    unsaved = undefined;
  } catch {
    unsaved = light;
  }
  window.dispatchEvent(new Event(TERMINAL_THEME_EVENT));
}

export function subscribeTerminalTheme(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== TERMINAL_LIGHT_STORAGE_KEY) return;
    try {
      window.localStorage.getItem(TERMINAL_LIGHT_STORAGE_KEY);
      unsaved = undefined;
    } catch {
      // Fully blocked storage must keep the page-local choice.
    }
    listener();
  };
  window.addEventListener(TERMINAL_THEME_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(TERMINAL_THEME_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export const TERMINAL_THEMES = {
  dark: {
    background: "#111318", foreground: "#d7dce5", cursor: "#60a5fa",
    selectionBackground: "#365b8a",
    black: "#1d222b", red: "#f87171", green: "#4ade80", yellow: "#facc15",
    blue: "#60a5fa", magenta: "#c084fc", cyan: "#22d3ee", white: "#e5e7eb",
    brightBlack: "#6b7280", brightRed: "#fca5a5", brightGreen: "#86efac",
    brightYellow: "#fde047", brightBlue: "#93c5fd", brightMagenta: "#d8b4fe",
    brightCyan: "#67e8f9", brightWhite: "#ffffff",
  },
  // Start with the app's light semantic colors; ANSI whites must be grey on white.
  light: {
    background: "#ffffff", foreground: "#1a1a1a", cursor: "#2563eb",
    cursorAccent: "#ffffff", selectionBackground: "#bfd7fb",
    black: "#1a1a1a", red: "#dc2626", green: "#15803d", yellow: "#b45309",
    blue: "#2563eb", magenta: "#7c3aed", cyan: "#0e7490", white: "#565e6b",
    brightBlack: "#3b4452", brightRed: "#b91c1c", brightGreen: "#047857",
    brightYellow: "#92400e", brightBlue: "#1d4ed8", brightMagenta: "#6d28d9",
    brightCyan: "#155e75", brightWhite: "#737373",
  },
} satisfies Record<"dark" | "light", ITheme>;
