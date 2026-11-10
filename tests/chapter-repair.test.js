import test from "node:test";
import assert from "node:assert/strict";
import { article, evidence } from "./paid-fixture.js";
import { articleBody, inspectPaid } from "../lib/paid-content.js";
import {
  composeResult,
  generationOptions,
  normalizeResult,
  generationPrompt,
  canApprove,
} from "../lib/generation.js";
import { chapterPlan } from "../lib/paid-chapter.js";
const section = "記入済みサンプル（架空の例）";
const placeholder = "### " + section + "\n入力例：未取得\n出力例：未取得\n";
const without = article.replace(
  /### 記入済みサンプル[\s\S]*?(?=### 完成テンプレート)/,
  "",
);
const previous = without.replace(
  "### 完成テンプレート",
  placeholder + "### 完成テンプレート",
);
const part =
  "#### 入力例\n入力例：架空の業務B、担当C、毎朝チェック。\n#### 出力例\n出力例：業務Bは担当Cが毎朝確認する一覧。";
const options = (extra = {}) =>
  generationOptions({
    mode: "chapter",
    section,
    format: "note有料記事",
    title: "業務整理ガイド",
    previous,
    evidence,
    projectId: "article-repair",
    ...extra,
  });
const result = (text, reason = "end_turn") =>
  normalizeResult(
    {
      stop_reason: reason,
      content: [{ type: "text", text }],
      usage: { input_tokens: 50, output_tokens: 50 },
    },
    "anthropic",
    "mock",
  );
test("normal chapter subheadings can repeat names used in other chapters without repeating those chapters", () => {
  const old = without.replace(
    "### 実践手順",
    "### 実践手順\n#### 入力例\n既存の入力に関する解説。",
  );
  const r = composeResult(result(part), options({ previous: old }));
  assert.equal(r.generation.project.artifacts.sample, true);
  assert.equal(r.generation.project.id, "article-repair");
  assert.equal(r.generation.project.humanReview.status, "pending");
  assert.equal(r.generation.validation.operation, "add");
  assert.equal(
    r.generation.project.sources[0].url,
    "https://www.digital.go.jp/policies/example",
  );
});
test("a missing artifact is supplemented in place with exactly one target heading and all original text retained", () => {
  const r = composeResult(result("### " + section + "\n" + part), options());
  const body = articleBody(r.body);
  assert.equal(body.split("### " + section).length - 1, 1);
  assert.ok(body.includes(placeholder.trim()));
  assert.equal(body.replace("\n\n" + part + "\n\n", ""), previous);
  assert.ok(body.indexOf(part) < body.indexOf("### 完成テンプレート"));
  assert.equal(r.generation.project.artifacts.sample, true);
  assert.deepEqual(r.generation.project.missing, []);
  assert.equal(r.generation.articleStatus, "needs_review");
  assert.equal(r.generation.validation.removedLeadingHeading, true);
});
test("already filled chapters, duplicate target headings and out-of-scope chapter responses remain rejected", () => {
  assert.throws(
    () => generationPrompt("normal", options({ previous: article })),
    /既に記入済み/,
  );
  for (const text of [
    "### " + section + "\n" + part + "\n### " + section + "\n反復",
    "### 実践手順\nやり直し",
    "# 業務整理ガイド\n再生成",
    "## 無料部分\n冒頭",
  ])
    assert.throws(() => composeResult(result(text), options()), /結合を停止/);
  assert.throws(
    () => chapterPlan(previous + "\n### " + section + "\n未取得", section),
    /複数/,
  );
});
test("long and newline-only duplicates remain rejected across all chapter content", () => {
  const repeated =
    "既存章にある固有の手順を照合して入力と出力の対応を確認してください。".repeat(
      6,
    );
  const old = previous.replace("準備：", "記録：" + repeated + "\n準備：");
  for (const text of [
    part + "\n" + repeated,
    part + "\n" + repeated.replaceAll("。", "。\n"),
  ])
    assert.throws(
      () => composeResult(result(text), options({ previous: old })),
      /重複/,
    );
});
test("interrupted non-last chapters continue inside that chapter after reload, preserving later chapters", () => {
  const first = composeResult(
    result("入力例：架空の業務B\n出力例：確認の途", "max_tokens"),
    options(),
  );
  assert.equal(first.generation.articleStatus, "incomplete");
  assert.equal(canApprove(first.generation), false);
  const loaded = JSON.parse(JSON.stringify(first));
  const o = options({ mode: "continue", previous: loaded.body });
  const prompt = generationPrompt("normal", o);
  assert.ok(prompt.includes("確認の途"));
  assert.ok(
    !JSON.parse(
      prompt.split("【既存原稿の構成と進捗：参考データ】\n")[1].split("\n")[0],
    ).tail.includes("### 完成テンプレート"),
  );
  const second = composeResult(result("中を最後まで記入します。"), o);
  assert.match(articleBody(second.body), /確認の途中を最後まで記入します。/);
  assert.equal(
    articleBody(second.body).split("### 完成テンプレート")[1],
    previous.split("### 完成テンプレート")[1],
  );
  assert.equal(second.generation.project.humanReview.status, "pending");
});
test("local subheading permission is chapter-scoped and does not relax continuation protection", () => {
  const old = previous.replace(
    "### 実践手順",
    "### 実践手順\n#### 入力例\n以前の説明",
  );
  assert.throws(
    () =>
      composeResult(result(part), options({ mode: "continue", previous: old })),
    /既出見出し/,
  );
});

test("actual APIs reject filled targets before a billable call and preserve saved originals on bad responses", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { readFileSync } = await import("node:fs");
  const chat = (await import("../functions/api/chat.js")).onRequestPost;
  const jobs = (await import("../functions/api/business/jobs.js"))
    .onRequestPost;
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(
      new URL("../migrations/0001_business_jobs.sql", import.meta.url),
      "utf8",
    ),
  );
  const adapter = {
    prepare(sql) {
      return {
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        },
        async first() {
          return db.prepare(sql).get(...this.args) || null;
        },
        async all() {
          return { results: db.prepare(sql).all(...this.args) };
        },
        async run() {
          return {
            meta: { changes: db.prepare(sql).run(...this.args).changes },
          };
        },
      };
    },
  };
  const env = {
    JARVIS_DB: adapter,
    JARVIS_ACCESS_PASSWORD: "test",
    ANTHROPIC_API_KEY: "mock",
  };
  let calls = 0,
    answer = part;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    calls++;
    assert.ok([2500, 4000].includes(JSON.parse(init.body).max_tokens));
    return Response.json({
      stop_reason: "end_turn",
      content: [{ type: "text", text: answer }],
    });
  };
  const req = (o) =>
    new Request("http://localhost/api", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-jarvis-password": "test",
      },
      body: JSON.stringify({
        department: "content",
        topic: "業務整理ガイド",
        format: "note有料記事",
        context: evidence,
        prompt: "章生成",
        generation: o,
      }),
    });
  try {
    for (const api of [chat, jobs]) {
      const r = await api({
        env,
        request: req(options({ previous: article })),
      });
      assert.equal(r.status, 409);
    }
    assert.equal(calls, 0);
    db.prepare(
      "INSERT INTO business_jobs(id,job_type,topic,status,output) VALUES('original','content_draft','元原稿','draft',?)",
    ).run(previous);
    for (const api of [chat, jobs]) {
      let r = await api({ env, request: req(options()) });
      assert.ok(r.ok);
      let d = await r.json();
      assert.equal(d.generation.project.artifacts.sample, true);
      answer = "### 実践手順\nやり直し";
      r = await api({ env, request: req(options()) });
      assert.equal(r.status, 409);
      answer = part;
    }
    assert.equal(calls, 4);
    assert.equal(
      db.prepare("SELECT output FROM business_jobs WHERE id='original'").get()
        .output,
      previous,
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ai_usage").get().n, 4);
  } finally {
    globalThis.fetch = original;
    db.close();
  }
});

test("newline-only boundary echo is rejected at the target even when a later template follows", () => {
  const tail =
    "対象資料の入力と出力を照合して、未確認の情報と確認できた情報を区別するために担当者が実施する手順を記録します。";
  const old = previous.replace("出力例：未取得", "出力例：" + tail);
  assert.throws(
    () =>
      composeResult(
        result(tail.replaceAll("、", "、\n") + "追記"),
        options({ mode: "continue", previous: old }),
      ),
    /改行違い/,
  );
});

test("an incomplete template can be supplemented without deleting its original code or instructions", () => {
  const old = article.replace(
    /### 完成テンプレート[\s\S]*/,
    "### 完成テンプレート\n使い方：未取得\n```text\n準備中\n```",
  );
  const text =
    "使い方：入力欄を埋めて本人に照合します。\n```text\n対象：[調査対象]\n確認：[確認担当]\n```";
  assert.equal(inspectPaid(old, evidence).artifacts.template, false);
  const r = composeResult(
    result(text),
    options({ previous: old, section: "完成テンプレート" }),
  );
  assert.equal(r.generation.project.artifacts.template, true);
  assert.ok(articleBody(r.body).includes("準備中\n```"));
  assert.equal(articleBody(r.body).split("### 完成テンプレート").length - 1, 1);
});

test("starting a new paid draft with its free chapter retains the requested article title", () => {
  const r = composeResult(
    result("読者向けの導入。"),
    options({ previous: "", section: "無料部分" }),
  );
  assert.match(
    articleBody(r.body),
    /^# 業務整理ガイド\n\n## 無料部分\n読者向け/,
  );
});
