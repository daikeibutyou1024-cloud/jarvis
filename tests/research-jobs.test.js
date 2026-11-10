import { budgetEnv, adaptDB, testDB } from "./runtime-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { onRequestPost } from "../functions/api/business/jobs.js";
import { manualRecord, researchPacket } from "../assets/research-data.js";
test("cloud drafts retain input source records even when the AI omits citations", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(
      new URL("../migrations/0001_business_jobs.sql", import.meta.url),
      "utf8",
    ),
  );
  const D1 = adaptDB(db);
  const env = {
    JARVIS_ACCESS_PASSWORD: "test",
    ...budgetEnv, ANTHROPIC_API_KEY: "fake",
    JARVIS_DB: D1,
  };
  const context = researchPacket([
    manualRecord({
      title: "比較商品",
      text: "公式を人が確認した仕様",
      sourceUrl: "https://example.com/product",
    }),
  ]);
  const request = (body) =>
    new Request("http://localhost/api/business/jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-jarvis-password": "test",
      },
      body: JSON.stringify(body),
    });
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({
      content: [{ type: "text", text: "AIが出典を書かなかった原稿" }],
    });
  };
  try {
    const response = await onRequestPost({
      request: request({ topic: "AI比較", department: "content", context }),
      env,
    });
    assert.equal(response.status, 201);
    const data = await response.json();
    assert.match(data.output, /https:\/\/example.com\/product/);
    assert.match(data.output, /手入力/);
    assert.equal(
      db.prepare("SELECT output FROM business_jobs").get().output,
      data.output,
    );
    assert.equal(
      (
        await onRequestPost({
          request: request({
            topic: "長すぎる指示",
            department: "content",
            context: "x".repeat(3500),
            notes: "x".repeat(2500),
          }),
          env,
        })
      ).status,
      400,
    );
    assert.equal(calls, 1);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM business_jobs").get().n,
      1,
    );
  } finally {
    globalThis.fetch = original;
    db.close();
  }
});
