import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createJiti } from "jiti";
import { unified } from "unified";
import remarkParse from "remark-parse";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  CJK_TEXT_MIN, SHELL_ENV_NAMES, startsWithEnvName, hasCjkOnlyPunctuation,
  hasTooManyCjkLetters, isProseMathText,
} = await jiti.import("./markdown-prose-math.ts");
const { markdownRemarkPlugins } = await jiti.import("./markdown.ts");
const processor = unified().use(remarkParse).use(markdownRemarkPlugins);

function inlineMath(markdown) {
  const tree = processor.runSync(processor.parse(markdown));
  const values = [];
  const walk = (node) => {
    if (node.type === "inlineMath") values.push(node.value);
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return values;
}

describe("shell environment names", () => {
  it("matches the listed names, not prefixes or arbitrary uppercase math", () => {
    for (const value of ["HOME", "HOME and ", " PATH ", "PATH=", "PORT=8080 和 ", "JAVA_HOME/x"]) {
      assert.equal(startsWithEnvName(value), true, value);
    }
    for (const value of ["PATHX", "PATHNAME", "home", "Path", "README", "HOST", "E=mc^2", "x"]) {
      assert.equal(startsWithEnvName(value), false, value);
    }
    assert.equal(SHELL_ENV_NAMES.length, 16);
    assert.equal(new Set(SHELL_ENV_NAMES).size, SHELL_ENV_NAMES.length);
  });
});

describe("CJK prose", () => {
  it("recognizes CJK-only punctuation, not marks shared with Latin text", () => {
    for (const value of ["a，b", "所以。", "为什么？", "重点：", "「重点」", "《论语》", "1、2", "１００％"]) {
      assert.equal(hasCjkOnlyPunctuation(value), true, value);
    }
    for (const value of ["x“这里”y", "a——b", "p…q", "a·b", "x’yy", "a-b", "a,b", "a＄b", "E=mc^2", "Ａ", "１２", "ユーザー", "\\text{条件：} x>0"]) {
      assert.equal(hasCjkOnlyPunctuation(value), false, value);
    }
  });

  it("allows short names but rejects more than five CJK letters", () => {
    assert.equal(CJK_TEXT_MIN, 5);
    for (const value of ["速度 v", "输入维度为 ", "总成本"]) {
      assert.equal(hasTooManyCjkLetters(value), false, value);
    }
    for (const value of ["模型输出概率分布", "总损失函数为交叉熵", "この変数は確率", "이 변수는 확률값"]) {
      assert.equal(hasTooManyCjkLetters(value), true, value);
    }
  });

  it("excludes TeX command arguments but counts an environment's body", () => {
    for (const value of ["\\text{总损失函数为交叉熵}", "\\text{输入维度为 } d", "\\frac{模型输出概率分布}{x}"]) {
      assert.equal(hasTooManyCjkLetters(value), false, value);
    }
    for (const value of ["\\begin{pmatrix}中文中文中文中文\\end{pmatrix}", "\\alpha 模型输出概率分布"]) {
      assert.equal(hasTooManyCjkLetters(value), true, value);
    }
  });
});

describe("isProseMathText", () => {
  it("fires on any prose rule", () => {
    for (const value of ["HOME and ", "PATH", "PORT=8080 和 ", "a，b", "「重点」", "模型输出概率分布"]) {
      assert.equal(isProseMathText(value), true, value);
    }
  });

  it("preserves equations, uppercase variables, padding and TeX text", () => {
    for (const value of [
      "E=mc^2", "PV=nRT", "AX=b", "AB", "R", "MSE", "SE", "DNA", "UV", "x y z", "速度 v", "总",
      "x + y", " x + y ", "x ", "2 + 2 = 4", "\\alpha", "x_i", "\\text{总损失}", "\\text{总损失函数为交叉熵}", "\\text{条件：} x>0", "\\text{ユーザー}", "\\text{Ａ}",
    ]) {
      assert.equal(isProseMathText(value), false, value);
      assert.equal(inlineMath(`$${value}$`).length, 1, value);
    }
  });
});

describe("the application's tokenizer guard", () => {
  it("rejects prose without consuming a later formula's opening dollar", () => {
    for (const formula of ["x + 1", "2 + 2 = 4", "\\alpha", "x_i"]) {
      assert.deepEqual(inlineMath(`见 $HOME 和 $${formula}$ 两个`), [formula]);
    }
    for (const prose of ["设置 $HOME 和 $PATH", "echo $HOME and$PATH", "配置 $PORT=8080 和 $HOST=localhost", "$模型输出概率分布$"]) {
      assert.deepEqual(inlineMath(prose), [], prose);
    }
  });

  it("a tight prose pair keeps its closing dollar from opening the next formula", () => {
    assert.deepEqual(inlineMath("$模型输出概率分布$ and $x+1$"), ["x+1"]);
    assert.deepEqual(inlineMath("设置 $HOME$ 和 $x$ 两个"), ["x"]);
    assert.deepEqual(inlineMath("$HOME$ $PATH$ $E=mc^2$"), ["E=mc^2"]);
  });

  it("keeps currency rejection and symmetric padding intact", () => {
    assert.deepEqual(inlineMath("$20 and $6"), []);
    assert.deepEqual(inlineMath("$20 and $x$"), ["x"]);
    assert.deepEqual(inlineMath("$ x + y $"), ["x + y"]);
    assert.deepEqual(inlineMath("$x$“这里”$y$"), ["x", "y"]);
    assert.deepEqual(inlineMath("$a$——$b$"), ["a", "b"]);
  });
});
