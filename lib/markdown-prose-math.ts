// Reject prose while pairing `$…$`, so its closing dollar can still open real math.
export const SHELL_ENV_NAMES = [
  "HOME", "PATH", "PORT", "USER", "PWD", "OLDPWD", "SHELL", "TMPDIR", "LANG",
  "TERM", "EDITOR", "DISPLAY", "PYTHONPATH", "JAVA_HOME", "NODE_PATH", "GOPATH",
] as const;

export const CJK_TEXT_MIN = 5;

// Deliberately excludes shared Latin quotes, dashes, ellipses, fullwidth ＄, fullwidth
// letters/digits, and the katakana prolonged-sound mark ー (a letter, as in ユーザー).
const CJK_ONLY_PUNCTUATION = new RegExp([
  "[\\u3000-\\u3003]",
  "[\\u3008-\\u3011]",
  "[\\u3014-\\u301F]",
  "\\u30FB",
  "[\\uFF01-\\uFF03\\uFF05-\\uFF0F\\uFF1A-\\uFF20\\uFF3B-\\uFF40\\uFF5B-\\uFF65]",
  "[\\uFE10-\\uFE19\\uFE30-\\uFE4F]",
].join("|"));

// shortcut: counts BMP CJK only, extend if rare astral ideographs need prose detection.
const CJK_LETTER = new RegExp([
  "[\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF]",
  "[\\u3041-\\u3096\\u309D-\\u30FF\\u31F0-\\u31FF]",
  "[\\u30A1-\\u30FA\\u30FC-\\u30FF]",
  "[\\uFF66-\\uFF9F]",
  "[\\u1100-\\u11FF\\uAC00-\\uD7AF]",
].join("|"), "g");

const COMMAND_ARGUMENT = /\\[A-Za-z]+\s*\{[^{}]*\}/g;

function withoutCommandArguments(value: string): string {
  let text = value;
  // shortcut: peel at most eight command layers, expand if deeper TeX needs support.
  for (let round = 0; round < 8; round++) {
    const peeled = text.replace(COMMAND_ARGUMENT, "");
    if (peeled === text) break;
    text = peeled;
  }
  return text;
}

export function startsWithEnvName(value: string): boolean {
  const name = value.trimStart().match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0];
  return name !== undefined && (SHELL_ENV_NAMES as readonly string[]).includes(name);
}

export function hasCjkOnlyPunctuation(value: string): boolean {
  return CJK_ONLY_PUNCTUATION.test(withoutCommandArguments(value));
}

export function hasTooManyCjkLetters(value: string): boolean {
  const letters = withoutCommandArguments(value).match(CJK_LETTER);
  return letters !== null && letters.length > CJK_TEXT_MIN;
}

export function isProseMathText(value: string): boolean {
  return startsWithEnvName(value) || hasCjkOnlyPunctuation(value) || hasTooManyCjkLetters(value);
}
