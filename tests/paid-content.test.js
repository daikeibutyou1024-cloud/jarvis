import { adaptDB } from "./runtime-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectPaid,
  renderPaidSources,
  articleBody,
  paidInstructions,
} from "../lib/paid-content.js";
import {
  composeResult,
  generationOptions,
  normalizeResult,
  canApprove,
  generationPrompt,
} from "../lib/generation.js";
import { article, evidence } from "./paid-fixture.js";
const options = (extra = {}) =>
  generationOptions({
    format: "note有料記事",
    title: "業務整理ガイド",
    evidence,
    ...extra,
  });
const generated = (text, reason = "end_turn") =>
  normalizeResult(
    { stop_reason: reason, content: [{ type: "text", text }] },
    "anthropic",
    "mock",
  );
test("paid deliverables are checked separately from provider completion and human review", () => {
  const r = composeResult(generated(article), options());
  assert.deepEqual(r.generation.project.missing, []);
  assert.equal(r.generation.articleStatus, "needs_review");
  assert.equal(r.generation.project.humanReview.status, "pending");
  assert.equal(canApprove(r.generation), true); // eligible for explicit human approval, never automatically approved
  assert.match(r.body, /取得日時：2026-11-10/);
  assert.equal(
    r.generation.project.sources[0].providedRange,
    "先頭700文字のみ",
  );
  assert.equal(articleBody(r.body), article);
});
test("free-only, planned product, empty sample and missing usable template cannot bypass manual completion", () => {
  for (const text of [
    "## 無料部分\n解説だけ",
    article.replace(
      /### 完成テンプレート[\s\S]*/,
      "### 完成テンプレート\nテンプレートは販売予定です。",
    ),
    article.replace(
      "入力例：架空の担当者A、会議資料整理、週1回。",
      "入力例：未取得",
    ),
    article.replace(
      "出力例：業務は会議資料整理、担当者はA、確認頻度は週1回。実在の実績ではありません。",
      "出力例：TODO",
    ),
  ]) {
    const r = composeResult(generated(text), options());
    assert.equal(r.generation.articleStatus, "incomplete");
    assert.ok(r.generation.project.missing.length);
    assert.equal(
      canApprove({ ...r.generation, articleStatus: "manual_complete" }),
      false,
    );
  }
});
test("unknown citations, missing citations and unregistered URLs are explicit deficiencies", () => {
  for (const [text, reason] of [
    [article + "\n[R9]", "存在しない"],
    [article.replace("[R1]", ""), "R番号"],
    [article + "\nhttps://unknown.example/info", "未登録URL"],
  ])
    assert.ok(
      inspectPaid(text, evidence).missing.some((x) => x.includes(reason)),
    );
  const p = inspectPaid(article, evidence);
  assert.equal(
    renderPaidSources(renderPaidSources(article, p), p),
    renderPaidSources(article, p),
  );
});
test("max_tokens preserves valid artifacts but blocks approval; explicit manual completion still needs content inspection", () => {
  const r = composeResult(generated(article, "max_tokens"), options());
  assert.equal(r.generation.articleStatus, "incomplete");
  assert.equal(canApprove(r.generation), false);
  assert.equal(
    canApprove({ ...r.generation, articleStatus: "manual_complete" }),
    true,
  );
});
test("paid chapters use a dedicated prompt, nested headings and duplicate protection", () => {
  const o = options({
    mode: "chapter",
    section: "実践手順",
    previous: "# 業務整理ガイド\n## 無料部分\n導入\n## 有料部分\n",
  });
  assert.doesNotMatch(
    generationPrompt("指定形式の完成原稿を作成", o),
    /指定形式の完成原稿/,
  );
  const r = composeResult(generated("準備：資料を用意"), o);
  assert.match(r.body, /### 実践手順/);
  assert.throws(
    () => composeResult(generated("## 無料部分\nやり直し"), o),
    /結合を停止/,
  );
  assert.throws(() => generationOptions({ ...o, section: "任意の不明章" }));
});
test("project identity and structured state survive serialization without assuming semantic quality", () => {
  const first = composeResult(generated(article), options());
  const second = composeResult(
    generated("\n次回は利用者が確認します。", "max_tokens"),
    options({
      mode: "continue",
      previous: first.body,
      projectId: first.generation.project.id,
    }),
  );
  const p = JSON.parse(JSON.stringify(second.generation.project));
  assert.equal(p.id, first.generation.project.id);
  assert.equal(p.generationState.stopReason, "max_tokens");
  assert.equal(p.artifacts.template, true);
  assert.ok(p.sections.length);
  assert.match(p.qualityNotice, /人間/);
});

test("cloud draft storage revalidates, restores review and source snapshots without Claude or quota writes", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const api = await import("../functions/api/business/paid-drafts.js");
  const db = new DatabaseSync(":memory:");
  const env = {
    JARVIS_ACCESS_PASSWORD: "test",
    JARVIS_DB: adaptDB(db),
  };
  const real = globalThis.fetch;
  globalThis.fetch = () => {
    throw Error("No external requests allowed");
  };
  try {
    const send = async (text, extra = {}) =>
      api.onRequestPost({
        env,
        request: new Request("http://localhost/api", {
          method: "POST",
          headers: {
            "x-jarvis-password": "test",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: "project-1",
            topic: "保存記事",
            text,
            evidence,
            approved: true,
            manualComplete: true,
            ...extra,
          }),
        }),
      });
    let r = await send("## 有料部分\n販売予定です");
    let d = await r.json();
    assert.equal(d.generation.project.humanReview.status, "pending");
    assert.equal(canApprove(d.generation), false);
    r = await send(article,{expectedRevision:1});
    d = await r.json();
    assert.equal(d.generation.project.humanReview.status, "approved");
    assert.equal(d.generation.project.id, "project-1");
    const loaded = await api.onRequestGet({
      env,
      request: new Request("http://localhost/api", {
        headers: { "x-jarvis-password": "test" },
      }),
    });
    const rows = (await loaded.json()).drafts;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].generation.project.sources[0].id, "R1");
    assert.equal(rows[0].generation.articleStatus, "manual_complete");
    assert.match(rows[0].output, /先頭700文字/);
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE name='ai_usage'",
        )
        .get().n,
      0,
    );
    assert.equal(
      (
        await api.onRequestGet({
          env,
          request: new Request("http://localhost/api"),
        })
      ).status,
      401,
    );
  } finally {
    globalThis.fetch = real;
    db.close();
  }
});

test("a chapter response cannot duplicate the heading inserted by the application", () => {
  assert.throws(
    () =>
      composeResult(
        generated("### 実践手順\n準備：資料\n### 実践手順\nもう一度"),
        options({
          mode: "chapter",
          section: "実践手順",
          previous: "# 記事\n## 有料部分\n",
        }),
      ),
    /二重生成/,
  );
});
