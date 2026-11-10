import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { buildPrompt } from "../assets/business.js";
import {
  generationPrompt,
  generationOptions,
  normalizeResult,
  composeResult,
  canApprove,
} from "../lib/generation.js";
import {
  continuationProgress,
  validatedContinuation,
} from "../lib/continuation.js";
import { onRequestPost as chat } from "../functions/api/chat.js";
import { onRequestPost as job } from "../functions/api/business/jobs.js";
const title = "初心者向けAI活用ガイド";
const longParagraph = Array.from(
  { length: 300 },
  (_, i) => `検証項目${i}：利用者の条件と出典を照合する。`,
).join("");
const previous = `# ${title}\n\n## 無料部分\n最初に読者の悩みを整理します。\n\n## 有料部分\n### STEP 1 準備\n準備済みです。\n### STEP 2 検証\n${longParagraph}\n### STEP 3 比較\n比較済みです。\n### STEP 4 実践\n入力条件を整え`;
const options = generationOptions({
  mode: "continue",
  previous,
  title,
  format: "note有料記事",
  evidence: "[R1] https://example.com / 未検証",
});
const generated = (text, stop_reason = "end_turn") =>
  normalizeResult(
    {
      stop_reason,
      content: [{ type: "text", text }],
      usage: { input_tokens: 1500, output_tokens: 350 },
    },
    "anthropic",
    "mock",
  );
function db() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(
    readFileSync(
      new URL("../migrations/0001_business_jobs.sql", import.meta.url),
      "utf8",
    ),
  );
  return {
    raw,
    prepare(sql) {
      return {
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        },
        async run() {
          return {
            meta: {
              changes: Number(raw.prepare(sql).run(...this.args).changes),
            },
          };
        },
        async first() {
          return raw.prepare(sql).get(...this.args) || null;
        },
        async all() {
          return { results: raw.prepare(sql).all(...this.args) };
        },
      };
    },
  };
}
const req = (body) =>
  new Request("http://localhost/api", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-jarvis-password": "test",
    },
    body: JSON.stringify(body),
  });
const env = (D1) => ({
  JARVIS_DB: D1,
  JARVIS_ACCESS_PASSWORD: "test",
  ANTHROPIC_API_KEY: "fake",
});
test("continuation uses a dedicated request with title, outline, inferred completed sections, current chapter and tail", () => {
  const base = buildPrompt(
    "content",
    { topic: title, format: "note有料記事" },
    "references",
  );
  const prompt = generationPrompt(base, options);
  const progress = continuationProgress(previous, options);
  assert.doesNotMatch(
    prompt,
    /指定形式の完成原稿を作成|無料導入と有料部分を分け/,
  );
  assert.match(prompt, /既存原稿の最後の文字の直後/);
  assert.match(prompt, new RegExp(title));
  assert.match(prompt, /STEP 4 実践/);
  assert.match(prompt, /completedSectionIds/);
  assert.ok(progress.completedSectionIds.includes(2));
  assert.ok(!progress.completedSectionIds.includes(3));
  assert.equal(progress.tail, previous.slice(-4000));
  assert.ok(progress.outline.some((h) => h.title === "STEP 1 準備"));
  assert.equal(prompt.includes(longParagraph), false);
  assert.match(prompt, /https:\/\/example.com/);
});
test("valid continuation appends once, passes structural checks and does not auto-complete an article", () => {
  const part =
    "、具体例に当てはめます。\n\n### STEP 5 振り返り\n結果を確認してください。";
  const r = composeResult(generated(part), options);
  assert.equal(r.body, previous + part);
  assert.equal(r.generation.validation.status, "accepted");
  assert.equal(r.generation.articleStatus, "needs_review");
  assert.equal(canApprove(r.generation), false);
  assert.equal(r.generation.stopReason, "end_turn");
  assert.ok(
    r.generation.progress.outline.some((h) => h.title === "STEP 5 振り返り"),
  );
});
test("rejects identical or rewritten top-level titles and repeated free/paid introductions", () => {
  for (const text of [
    `# ${title}\n## 無料部分\n新しい導入`,
    `${title}\n導入から始めます。`,
    "# 別のタイトル\n新しい記事",
    "## 無料パート\n再度説明します。",
    "## 有料部分\n有料の説明",
  ])
    assert.throws(
      () => composeResult(generated(text), options),
      (e) => e.code === "INVALID_CONTINUATION",
      text,
    );
});
test("rejects completed/current chapters including changed titles and full-width numbering", () => {
  for (const text of [
    "### STEP 1 準備\nやり直し",
    "### STEP 2 新しい見出し\nやり直し",
    "### ＳＴＥＰ ４ 実践\n再開",
    "### STEP 4 実践\n再掲",
  ])
    assert.throws(
      () => validatedContinuation(previous, text, options),
      (e) => e.code === "INVALID_CONTINUATION",
    );
  const jp = "# 記事\n## 第一章 準備\n準備完了\n## 第二章 実践\n途中";
  assert.throws(() =>
    validatedContinuation(jp, "## 第1章 改題\nやり直し", { title: "記事" }),
  );
});
test("detects internal long repetition and whitespace/newline differences, not just a boundary match", () => {
  const interior = longParagraph.slice(200, 700);
  assert.throws(
    () => validatedContinuation(previous, "追加の前置き。" + interior, options),
    /長文重複/,
  );
  assert.throws(
    () =>
      validatedContinuation(
        previous,
        interior.split("。").join("。\n\n"),
        options,
      ),
    /長文重複/,
  );
  const boundary =
    "確認事項を整理して対象の入力と出力を明確にし、その結果を公式の資料と照合してください。".repeat(
      2,
    );
  assert.throws(
    () =>
      validatedContinuation(
        "前半。" + boundary,
        boundary.replaceAll("、", "、\n") + "新規文。",
        { title: "記事" },
      ),
    /改行違い/,
  );
});
test("detects more-than-500 character overlap but preserves safe short exact boundary de-duplication", () => {
  const overlap = longParagraph.slice(0, 1100);
  assert.throws(
    () => validatedContinuation("前半。" + overlap, overlap + "新しい本文。"),
    /長い境界重複/,
  );
  const short =
    "直前の確認事項を整理し、対象の入力と出力を明確にしてください。";
  const r = validatedContinuation("前半。" + short, short + "次の説明。");
  assert.equal(r.text, "次の説明。");
  assert.equal(r.validation.removedExactBoundaryCharacters, short.length);
  assert.throws(
    () => validatedContinuation("前半。" + short, short),
    /追加本文がなく/,
  );
});
test("another max_tokens result stays incomplete and supports a further explicit continuation", () => {
  const first = composeResult(
    generated("、次の入力を用意し", "max_tokens"),
    options,
  );
  assert.equal(first.generation.articleStatus, "incomplete");
  assert.equal(first.generation.stopReason, "max_tokens");
  const second = composeResult(
    generated("て検証します。"),
    generationOptions({ ...options, previous: first.body }),
  );
  assert.equal(second.body, previous + "、次の入力を用意して検証します。");
  assert.equal(second.generation.articleStatus, "needs_review");
});
test("normal and chapter generation retain their existing behavior", () => {
  const result = generated("通常原稿");
  assert.equal(
    composeResult(result, generationOptions()).generation.articleStatus,
    "complete",
  );
  const chapter = composeResult(
    result,
    generationOptions({
      mode: "chapter",
      section: "STEP 5",
      previous: "元の原稿",
    }),
  );
  assert.equal(chapter.body, "元の原稿\n\n## STEP 5\n通常原稿");
  assert.equal(chapter.generation.articleStatus, "incomplete");
});
test("normal API rejects restarts without returning merged body and consumes exactly one capped request", async () => {
  const D1 = db(),
    original = fetch;
  let calls = 0;
  globalThis.fetch = async (_url, opt) => {
    calls++;
    const p = JSON.parse(opt.body);
    assert.equal(p.max_tokens, 4000);
    assert.doesNotMatch(p.messages[0].content, /指定形式の完成原稿を作成/);
    return Response.json({
      stop_reason: "end_turn",
      usage: { output_tokens: 40 },
      content: [{ type: "text", text: `# ${title}\n再生成` }],
    });
  };
  try {
    const r = await chat({
      request: req({
        prompt: buildPrompt("content", {
          topic: title,
          format: "note有料記事",
        }),
        generation: options,
      }),
      env: env(D1),
    });
    assert.equal(r.status, 409);
    const body = await r.json();
    assert.equal(body.code, "INVALID_CONTINUATION");
    assert.equal(body.answer, undefined);
    assert.equal(body.generation.validation.status, "rejected");
    assert.equal(body.generation.articleStatus, "incomplete");
    assert.equal(calls, 1);
    assert.equal(
      D1.raw.prepare("SELECT COUNT(*) AS n FROM ai_usage").get().n,
      1,
    );
  } finally {
    globalThis.fetch = original;
    D1.raw.close();
  }
});
test("cloud rejection preserves original saved draft, stores no bad output and never retries", async () => {
  const D1 = db(),
    original = fetch;
  D1.raw
    .prepare(
      "INSERT INTO business_jobs(id,job_type,topic,status,output) VALUES('original','content_draft','記事','draft',?)",
    )
    .run(previous);
  let calls = 0;
  globalThis.fetch = async (_url, opt) => {
    calls++;
    assert.equal(JSON.parse(opt.body).max_tokens, 2500);
    return Response.json({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "### STEP 1 準備\n再生成" }],
    });
  };
  try {
    const r = await job({
      request: req({
        topic: title,
        department: "content",
        format: "note有料記事",
        generation: options,
      }),
      env: env(D1),
    });
    assert.equal(r.status, 409);
    assert.equal(
      D1.raw
        .prepare("SELECT output FROM business_jobs WHERE id='original'")
        .get().output,
      previous,
    );
    const rejected = D1.raw
      .prepare(
        "SELECT status,output,error FROM business_jobs WHERE id!='original'",
      )
      .get();
    assert.equal(rejected.status, "failed");
    assert.equal(rejected.output, null);
    assert.match(rejected.error, /元の原稿は保持/);
    assert.equal(calls, 1);
    assert.equal(
      JSON.parse(
        D1.raw
          .prepare("SELECT generation_json FROM business_job_generations")
          .get().generation_json,
      ).validation.status,
      "rejected",
    );
  } finally {
    globalThis.fetch = original;
    D1.raw.close();
  }
});

test("historical continuation end_turn is not treated as whole-article completion", () => {
  assert.equal(
    canApprove({
      mode: "continue",
      articleStatus: "complete",
      stopReason: "end_turn",
    }),
    false,
  );
  assert.equal(
    canApprove({
      mode: "continue",
      articleStatus: "manual_complete",
      stopReason: "end_turn",
    }),
    true,
  );
});
