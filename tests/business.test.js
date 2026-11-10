import test from "node:test";
import assert from "node:assert/strict";
import {
  departments,
  buildPrompt,
  financeTotals,
  metricsSummary,
} from "../assets/business.js";
import { onRequestPost, onRequestGet } from "../functions/api/business/jobs.js";
import { onRequestPost as chat } from "../functions/api/chat.js";
const request = (body = {}, password = "test") =>
  new Request("http://localhost/api/business/jobs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-jarvis-password": password,
    },
    body: JSON.stringify(body),
  });
const env = { JARVIS_ACCESS_PASSWORD: "test", ANTHROPIC_API_KEY: "fake" };
test("all departments use factual, draft-only instructions", () => {
  for (const d of Object.keys(departments)) {
    const prompt = buildPrompt(d, { topic: "AI", format: "X投稿" });
    assert.match(prompt, new RegExp(departments[d].name));
    assert.match(prompt, /下書きのみ/);
    assert.match(prompt, /未検証/);
  }
});
test("finance subtracts both API and other costs exactly once", () => {
  assert.deepEqual(
    financeTotals([
      { type: "revenue", amount: 10000 },
      { type: "expense", amount: 2000 },
      { type: "api", amount: 500 },
    ]),
    { revenue: 10000, expense: 2000, api: 500, profit: 7500 },
  );
  assert.equal(financeTotals([]).profit, 0);
});
test("zero denominators and unentered metrics are not invented", () => {
  assert.match(metricsSummary(), /未入力/);
  assert.match(
    metricsSummary({ period: "2026-11", visits: 0, clicks: 0, conversions: 0 }),
    /算出不可/,
  );
});
test("auth blocks jobs before database access", async () => {
  assert.equal(
    (await onRequestPost({ request: request(), env: {} })).status,
    503,
  );
  assert.equal(
    (await onRequestPost({ request: request({}, "wrong"), env })).status,
    401,
  );
  assert.equal(
    (await onRequestGet({ request: request({}, "wrong"), env })).status,
    401,
  );
});
test("existing chat auth and validation remain intact", async () => {
  assert.equal(
    (await chat({ request: request({}, "wrong"), env })).status,
    401,
  );
  assert.equal(
    (await chat({ request: request({ prompt: "" }), env })).status,
    400,
  );
});
test("jobs validate department and context before reserving a job", async () => {
  const config = {
    ...env,
    JARVIS_DB: {
      prepare() {
        throw Error("must not access");
      },
    },
  };
  assert.equal(
    (
      await onRequestPost({
        request: request({ department: "calendar" }),
        env: config,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await onRequestPost({
        request: request({ notes: "x".repeat(2501) }),
        env: config,
      })
    ).status,
    400,
  );
});
test("daily cap reserves atomically and prevents provider calls", async () => {
  let called = 0;
  const config = {
    ...env,
    JARVIS_DB: {
      prepare(sql) {
        if (/CREATE|DELETE/.test(sql))
          return {
            bind() {
              return this;
            },
            async run() {
              return { meta: { changes: 0 } };
            },
          };
        assert.match(sql, /INSERT.*SELECT.*COUNT/s);
        return {
          bind() {
            return this;
          },
          async run() {
            called++;
            return { meta: { changes: 0 } };
          },
        };
      },
    },
  };
  assert.equal(
    (await onRequestPost({ request: request({ topic: "test" }), env: config }))
      .status,
    429,
  );
  assert.equal(called, 1);
});
test("cloud generation preserves D1 lifecycle and both providers", async () => {
  const original = globalThis.fetch;
  try {
    for (const provider of ["anthropic", "openai"]) {
      const updates = [];
      globalThis.fetch = async (url, options) => {
        assert.match(
          url,
          provider === "openai" ? /api.openai.com/ : /api.anthropic.com/,
        );
        assert.match(options.body, /MARKETING/);
        return Response.json(
          provider === "openai"
            ? { choices: [{ message: { content: "安全な下書き" } }] }
            : { content: [{ type: "text", text: "安全な下書き" }] },
        );
      };
      const config = {
        ...env,
        AI_PROVIDER: provider,
        OPENAI_API_KEY: "fake",
        JARVIS_DB: {
          prepare(sql) {
            return {
              bind(...params) {
                if (!sql.includes("ai_usage")) updates.push({ sql, params });
                return this;
              },
              async run() {
                return { meta: { changes: 1 } };
              },
            };
          },
        },
      };
      const result = await onRequestPost({
        request: request({ department: "marketing", topic: "AI" }),
        env: config,
      });
      assert.equal(result.status, 201);
      assert.equal((await result.json()).output, "安全な下書き");
      assert.equal(updates[0].params[1], "marketing_draft");
      assert.match(updates[1].sql, /status='draft'/);
    }
  } finally {
    globalThis.fetch = original;
  }
});
test("failed provider marks job failed without exposing credentials", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ error: { message: "secret-leak" } }, { status: 500 });
  try {
    const statements = [];
    const config = {
      ...env,
      JARVIS_DB: {
        prepare(sql) {
          statements.push(sql);
          return {
            bind() {
              return this;
            },
            async run() {
              return { meta: { changes: 1 } };
            },
          };
        },
      },
    };
    const result = await onRequestPost({
      request: request({ topic: "AI" }),
      env: config,
    });
    assert.equal(result.status, 503);
    assert.doesNotMatch(await result.text(), /secret-leak/);
    assert.ok(statements.some((s) => s.includes("status='failed'")));
  } finally {
    globalThis.fetch = original;
  }
});

test("finance avoids fractional-yen floating point drift", () => {
  assert.equal(
    financeTotals([
      { type: "revenue", amount: 0.1 },
      { type: "revenue", amount: 0.2 },
    ]).profit,
    0.3,
  );
});
