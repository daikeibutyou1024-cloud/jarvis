import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { onRequestPost as chat } from "../functions/api/chat.js";
import {
  onRequestPost as job,
  onRequestGet as jobs,
} from "../functions/api/business/jobs.js";
import {
  normalizeResult,
  composeResult,
  generationOptions,
  generationPrompt,
  canApprove,
  EVIDENCE_SEPARATOR,
} from "../lib/generation.js";
import {
  researchPacket,
  bodyState,
  handoffIsStale,
  manualRecord,
} from "../assets/research-data.js";
import { validateEvidence } from "../lib/research-ideas.js";
function store() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(
      new URL("../migrations/0001_business_jobs.sql", import.meta.url),
      "utf8",
    ),
  );
  return {
    db,
    prepare(sql) {
      return {
        args: [],
        bind(...a) {
          this.args = a;
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
            meta: {
              changes: Number(db.prepare(sql).run(...this.args).changes),
            },
          };
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
const config = (db) => ({
  JARVIS_DB: db,
  JARVIS_ACCESS_PASSWORD: "test",
  ANTHROPIC_API_KEY: "fake",
});
function response(reason = "end_turn", text = "原稿の続き。") {
  return Response.json({
    stop_reason: reason,
    usage: {
      input_tokens: 1234,
      output_tokens: 2500,
      cache_read_input_tokens: 12,
    },
    content: [{ type: "text", text }],
  });
}
test("max_tokens, other interrupted reasons and missing metadata never count as complete", () => {
  for (const stop_reason of [
    "max_tokens",
    "pause_turn",
    "tool_use",
    "refusal",
    undefined,
  ]) {
    const r = normalizeResult(
      {
        stop_reason,
        content: [{ type: "text", text: "STEP 4の途" }],
        usage: { output_tokens: 2500 },
      },
      "anthropic",
      "model",
    );
    const result = composeResult(r, generationOptions());
    assert.equal(canApprove(result.generation), false);
    assert.equal(result.generation.usage.output_tokens, 2500);
  }
  assert.equal(
    normalizeResult(
      { stop_reason: "end_turn", content: [] },
      "anthropic",
      "model",
    ).generation.completionStatus,
    "complete",
  );
  assert.equal(
    normalizeResult(
      {
        choices: [{ finish_reason: "length", message: { content: "partial" } }],
      },
      "openai",
      "model",
    ).generation.completionStatus,
    "incomplete",
  );
});
test("chapter generation remains an incomplete article and continuation only sends bounded tail", () => {
  const options = generationOptions({
    mode: "chapter",
    section: "STEP 4",
    previous: "a".repeat(9000),
  });
  const prompt = generationPrompt("source", options);
  assert.equal(prompt.includes("a".repeat(4001)), false);
  assert.match(prompt, /末尾最大4000/);
  const out = composeResult(
    normalizeResult(
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "章の本文" }],
      },
      "anthropic",
      "model",
    ),
    options,
  );
  assert.equal(out.generation.articleStatus, "incomplete");
  assert.ok(out.body.startsWith("a".repeat(9000)));
  assert.match(out.body, /STEP 4/);
  assert.throws(() => generationOptions({ mode: "continue" }));
  assert.throws(() => generationOptions({ mode: "chapter", section: "" }));
  assert.throws(() =>
    generationOptions({ mode: "continue", previous: "x".repeat(30001) }),
  );
});
test("normal API exposes finish reason and usage without increasing output cap", async () => {
  const db = store(),
    original = fetch;
  let payload;
  globalThis.fetch = async (_url, o) => {
    payload = JSON.parse(o.body);
    return response("max_tokens", "STEP 4の途");
  };
  try {
    const r = await chat({
      request: req({ prompt: "note有料記事" }),
      env: config(db),
    });
    const data = await r.json();
    assert.equal(data.answer, "STEP 4の途");
    assert.equal(data.generation.articleStatus, "incomplete");
    assert.equal(data.generation.stopReason, "max_tokens");
    assert.equal(data.generation.usage.input_tokens, 1234);
    assert.equal(payload.max_tokens, 4000);
  } finally {
    globalThis.fetch = original;
    db.db.close();
  }
});
test("cloud persists incomplete state, reloads metadata, retains sources and existing quota", async () => {
  const db = store(),
    original = fetch;
  let calls = 0;
  globalThis.fetch = async (_url, o) => {
    calls++;
    assert.equal(JSON.parse(o.body).max_tokens, 2500);
    return response("max_tokens", "未完成の本文");
  };
  try {
    const context = "【RESEARCH 3.0 引き継ぎ資料】出典：https://example.com";
    const r = await job({
      request: req({ topic: "AI", department: "content", context }),
      env: config(db),
    });
    assert.equal(r.status, 201);
    const data = await r.json();
    assert.equal(data.generation.articleStatus, "incomplete");
    const stored = JSON.parse(
      db.db
        .prepare("SELECT generation_json FROM business_job_generations")
        .get().generation_json,
    );
    assert.equal(stored.stopReason, "max_tokens");
    assert.equal(stored.usage.output_tokens, 2500);
    assert.match(
      db.db.prepare("SELECT output FROM business_jobs").get().output,
      /出典：https/,
    );
    const list = await (
      await jobs({ request: req({}), env: config(db) })
    ).json();
    assert.equal(list.jobs[0].generation.articleStatus, "incomplete");
    for (let i = 0; i < 4; i++)
      await job({
        request: req({ topic: "AI", department: "content" }),
        env: config(db),
      });
    const limit = await job({
      request: req({
        topic: "AI",
        department: "content",
        generation: { mode: "continue", previous: "未完成" },
      }),
      env: config(db),
    });
    assert.equal(limit.status, 429);
    assert.equal(calls, 5);
  } finally {
    globalThis.fetch = original;
    db.db.close();
  }
});
test("explicit continuation preserves earlier text and consumes one of the same daily quota", async () => {
  const db = store(),
    original = fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return response("end_turn", "そして結論です。");
  };
  try {
    const r = await chat({
      request: req({
        prompt: "記事の指示",
        generation: { mode: "continue", previous: "STEP 4の途中。" },
      }),
      env: config(db),
    });
    const data = await r.json();
    assert.equal(data.answer, "STEP 4の途中。そして結論です。");
    assert.equal(data.generation.articleStatus, "needs_review");
    assert.equal(
      db.db.prepare("SELECT COUNT(*) AS n FROM ai_usage").get().n,
      1,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
    db.db.close();
  }
});
const source = {
  ...manualRecord({
    title: "公式資料",
    text: "RSS見出しのみ取得。記事本文・商品仕様は未取得。",
    sourceUrl: "https://www.digital.go.jp/news/test",
  }),
  kind: "fact",
  verification: "source_observed",
  bodyText: "本文の内容です。".repeat(130),
  bodyFetchedAt: "2026-11-10T00:00:00Z",
  fetchedAt: "2026-11-09T00:00:00Z",
  reviewedAt: "2026-11-10T01:00:00Z",
};
test("acquired body excludes obsolete RSS fallback and accurately reports source, range and review state", () => {
  const packet = researchPacket([source]);
  assert.doesNotMatch(packet, /記事本文・商品仕様は未取得|RSS見出しのみ取得/);
  assert.match(packet, /本文取得状態：取得済み/);
  assert.match(packet, /先頭700文字のみ/);
  assert.match(packet, /全文は未提供/);
  assert.match(packet, /2026-11-09T00:00:00Z/);
  assert.match(packet, /2026-11-10T00:00:00Z/);
  assert.match(packet, /利用者確認日時/);
  assert.doesNotMatch(validateEvidence([source])[0].text, /記事本文.*未取得/);
  const unreviewed = { ...source, reviewedAt: null };
  assert.equal(bodyState(unreviewed).acquired, true);
  assert.match(researchPacket([unreviewed]), /利用者確認日時：未確認/);
  assert.throws(() => validateEvidence([unreviewed]));
  assert.match(
    researchPacket([{ ...source, bodyText: "短い本文。" }]),
    /抽出本文5文字すべて/,
  );
});
test("old handoff is invalidated by updated body, review state, RSS refresh or deletion", () => {
  assert.equal(handoffIsStale([source], [structuredClone(source)]), false);
  for (const change of [
    { bodyText: "new body" },
    { bodyFetchedAt: "2026-11-11T00:00:00Z" },
    { reviewedAt: null },
    { id: "new-rss-id" },
    { text: "new summary" },
  ])
    assert.equal(handoffIsStale([source], [{ ...source, ...change }]), true);
  assert.equal(handoffIsStale([source], []), true);
});
test("legacy cloud drafts are explicitly completion-unknown without breaking their contents", async () => {
  const db = store();
  db.db
    .prepare(
      "INSERT INTO business_jobs(id,job_type,topic,status,output) VALUES('old','content_draft','旧記事','draft','従来の原稿')",
    )
    .run();
  try {
    const data = await (
      await jobs({ request: req({}), env: config(db) })
    ).json();
    assert.equal(data.jobs[0].generation.articleStatus, "unknown");
    assert.equal(data.jobs[0].output, "従来の原稿");
  } finally {
    db.db.close();
  }
});
