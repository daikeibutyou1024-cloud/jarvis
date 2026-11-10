import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { article, evidence } from "./paid-fixture.js";
import { inspectPaid, articleBody } from "../lib/paid-content.js";
import * as chat from "../functions/api/chat.js";
import * as jobs from "../functions/api/business/jobs.js";
import * as drafts from "../functions/api/business/paid-drafts.js";
const { chromium } = createRequire("/workspace/jarvis-tools/package.json")(
  "playwright",
);
const db = new DatabaseSync(":memory:");
db.exec(
  readFileSync(
    new URL("../migrations/0001_business_jobs.sql", import.meta.url),
    "utf8",
  ),
);
const env = {
  JARVIS_ACCESS_PASSWORD: "test",
  ANTHROPIC_API_KEY: "mock",
  JARVIS_DB: {
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
  },
};
let calls = 0,
  next = "### 実践手順\n逆戻り",
  reason = "end_turn";
const original = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  calls++;
  assert.equal(JSON.parse(init.body).max_tokens, 4000);
  return Response.json({
    stop_reason: reason,
    content: [{ type: "text", text: next }],
  });
};
const section = "記入済みサンプル（架空の例）";
const previous = article
  .replace(
    /### 記入済みサンプル[\s\S]*?(?=### 完成テンプレート)/,
    `### ${section}\n入力例：未取得\n出力例：未取得\n`,
  )
  .replace("### 実践手順", "### 実践手順\n#### 入力例\n元の入力解説。");
const generation = {
  format: "note有料記事",
  mode: "full",
  completionStatus: "complete",
  articleStatus: "incomplete",
  stopReason: "end_turn",
  project: inspectPaid(previous, evidence, { id: "browser-article" }),
};
const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    ({ previous, generation, evidence }) => {
      if (!localStorage.getItem("chapter-seeded")) {
        localStorage.setItem("chapter-seeded", "1");
        localStorage.setItem(
          "jarvis_business_drafts_v1",
          JSON.stringify([
            {
              topic: "章補完テスト",
              format: "note有料記事",
              department: "content",
              text: previous,
              generation,
              evidence,
              approved: false,
            },
          ]),
        );
      }
    },
    { previous, generation, evidence },
  );
  await page.route("**/api/**", async (route) => {
    const r = route.request();
    const request = new Request(r.url(), {
      method: r.method(),
      headers: r.headers(),
      ...(r.method() === "POST" ? { body: r.postData() } : {}),
    });
    const api = r.url().includes("paid-drafts")
      ? drafts
      : r.url().includes("business/jobs")
        ? jobs
        : chat;
    const res = await api[
      r.method() === "POST" ? "onRequestPost" : "onRequestGet"
    ]({ request, env });
    await route.fulfill({
      status: res.status,
      contentType: "application/json",
      body: await res.text(),
    });
  });
  const auth = async () => {
    await page.locator("#password").fill("test");
    await page.locator("#auth-form button.primary").click();
  };
  await page.goto(
    (process.env.BASE_URL || "http://localhost:8091") + "/#content",
  );
  await page
    .locator("#drafts button")
    .getByText("開く", { exact: true })
    .first()
    .click();
  await page.locator("#save-paid-cloud").click();
  await auth();
  await page.waitForFunction(() =>
    document.querySelector("#cloud-jobs").textContent.includes("章補完テスト"),
  );
  const originalCloud = db
    .prepare("SELECT output FROM paid_content_drafts")
    .get().output;
  await page.locator("#content-generation-mode").selectOption("chapter");
  await page.locator("#content-section").fill(section);
  await page.locator("#generate").click();
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("結合を停止"),
  );
  const originalDisplayed = await page.locator("#output").inputValue();
  assert.equal(articleBody(originalDisplayed), previous);
  assert.equal(
    db.prepare("SELECT output FROM paid_content_drafts").get().output,
    originalCloud,
  );
  reason = "max_tokens";
  next = `### ${section}\n#### 入力例\n入力例：架空の対象業務と担当D。\n#### 出力例\n出力例：担当Dが作る確認一覧の途`;
  await page.locator("#generate").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#generation-status")
      .textContent.includes("max_tokens"),
  );
  assert.match(await page.locator("#review-state").innerText(), /未完成/);
  await page.locator("#save-draft").click();
  await page.reload();
  await page
    .locator("#drafts button")
    .getByText("開く", { exact: true })
    .first()
    .click();
  next = "中を記入し、架空のサンプルとして確認してください。";
  reason = "end_turn";
  await page.locator("#continue-local").click();
  await auth();
  await page.waitForFunction(() =>
    document
      .querySelector("#generation-status")
      .textContent.includes("end_turn"),
  );
  const completed = await page.locator("#output").inputValue();
  assert.match(articleBody(completed), /一覧の途中を記入/);
  assert.equal(articleBody(completed).split("### " + section).length - 1, 1);
  assert.equal(
    articleBody(completed).split("### 完成テンプレート")[1],
    previous.split("### 完成テンプレート")[1],
  );
  await page.locator("#approve").click();
  assert.match(await page.locator("#review-state").innerText(), /^確認済み/);
  await page.locator("#save-paid-cloud").click();
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("クラウドに保存"),
  );
  await page
    .locator("#cloud-jobs button")
    .getByText("開く", { exact: true })
    .first()
    .click();
  assert.match(await page.locator("#review-state").innerText(), /^確認済み/);
  const savedRow = db
    .prepare("SELECT generation_json FROM paid_content_drafts")
    .get();
  assert.equal(JSON.parse(savedRow.generation_json).section, section);
  assert.equal(
    JSON.parse(savedRow.generation_json).project.sources[0].id,
    "R1",
  );
  await page.locator("#content-generation-mode").selectOption("chapter");
  await page.locator("#content-section").fill(section);
  const before = calls;
  await page.locator("#generate").click();
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("既に記入済み"),
  );
  assert.equal(calls, before);
  assert.match(await page.locator("#review-state").innerText(), /^確認済み/);
  assert.equal(
    db.prepare("SELECT generation_json FROM paid_content_drafts").get()
      .generation_json,
    savedRow.generation_json,
  );
  assert.equal(calls, 3);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real API mock chapter repair, rejection preserves original/cloud/review, interrupted middle chapter resume, citations, local/cloud reload, no retry",
  );
} finally {
  await browser.close();
  globalThis.fetch = original;
  db.close();
}
