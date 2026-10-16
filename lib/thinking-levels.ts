import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

/** The thinking levels pi accepts, in ascending order. */
export const THINKING_LEVELS: readonly ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** Display-only labels (Claude Desktop style); values sent to pi stay lowercase. */
export const THINKING_LEVEL_LABELS: Record<ThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra",
  max: "Max",
};

/** An optional `:level` suffix on an `enabledModels` pattern (`anthropic/*:high`). */
export const THINKING_SUFFIX = new RegExp(`:(${THINKING_LEVELS.join("|")})$`);
