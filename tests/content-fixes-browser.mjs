import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  normalizeResult,
  composeResult,
  generationOptions,
  EVIDENCE_SEPARATOR,
} from "../lib/generation.js";
let playwright;
try {
  playwright = await import("playwright");
} catch {
  playwright = createRequire("/workspace/jarvis-tools/package.json")(
    "playwright",
  );
}
const browser = await playwright.chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let calls = 0,
    lastPrompt = "",
    cloudJobs = [],
    bodyVersion = 0;
  const source = {
    id: "rss-record",
    title: "公式記事",
    text: "RSS見出しのみ取得。記事本文・商品仕様は未取得。",
    sourceUrl: "https://www.digital.go.jp/policies/genai/example",
    fetchedAt: "2026-11-10T01:00:00Z",
    recordedAt: "2026-11-10T01:00:00Z",
    kind: "fact",
    origin: "digital",
    verification: "source_observed",
  };
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    if (req.headers()["x-jarvis-password"] !== "test")
      return route.fulfill({ status: 401, json: { error: "認証失敗" } });
    if (req.url().includes("/research/collect"))
      return route.fulfill({
        json: {
          status: "acquired",
          label: "取得済み",
          items: [source],
          fetchedAt: source.fetchedAt,
        },
      });
    if (req.url().includes("/research/article")) {
      bodyVersion++;
      return route.fulfill({
        json: {
          status: "acquired",
          text: `取得本文第${bodyVersion}版。` + "公式本文の説明。".repeat(150),
          fetchedAt: `2026-11-10T02:00:0${bodyVersion}Z`,
        },
      });
    }
    if (req.method() === "GET")
      return route.fulfill({ json: { jobs: cloudJobs } });
    calls++;
    const payload = req.postDataJSON(),
      o = generationOptions(payload.generation);
    lastPrompt = payload.prompt || payload.context;
    const reason = o.mode === "full" ? "max_tokens" : "end_turn";
    const part = o.mode === "full" ? "STEP 4：手順の途" : "続きの説明と結論。";
    const result = composeResult(
      normalizeResult(
        {
          stop_reason: reason,
          usage: {
            input_tokens: 900,
            output_tokens: reason === "max_tokens" ? 2500 : 300,
          },
          content: [{ type: "text", text: part }],
        },
        "anthropic",
        "model",
      ),
      o,
    );
    if (req.url().endsWith("/chat"))
      return route.fulfill({
        json: { answer: result.body, generation: result.generation },
      });
    const output =
      result.body +
      (payload.context ? EVIDENCE_SEPARATOR + payload.context : "");
    const job = {
      id: String(calls),
      job_type: "content_draft",
      topic: payload.topic,
      status: "draft",
      output,
      generation: result.generation,
      created_at: "2026-11-10 00:00:00",
    };
    cloudJobs = [job, ...cloudJobs];
    return route.fulfill({ status: 201, json: { ...job, body: result.body } });
  });
  async function auth() {
    await page.locator("#password").fill("test");
    await page.locator("#auth-form button.primary").click();
  }
  await page.goto(
    (process.env.BASE_URL || "http://localhost:8080") + "/#content",
  );
  await page.locator("#topic").fill("note有料記事");
  await page.locator("#format").selectOption("note無料記事");
  await page.locator("#generate").click();
  await auth();
  await page.waitForFunction(() =>
    document.querySelector("#review-state").textContent.includes("未完成"),
  );
  assert.match(
    await page.locator("#generation-status").innerText(),
    /max_tokens/,
  );
  assert.match(await page.locator("#generation-status").innerText(), /2500/);
  await page.locator("#approve").click();
  assert.match(
    await page.locator("#status").innerText(),
    /確認済みにできません/,
  );
  await page.locator("#save-draft").click();
  assert.match(await page.locator("#drafts").innerText(), /未完成/);
  await page.reload();
  await page
    .locator("#drafts button")
    .getByText("開く", { exact: true })
    .click();
  assert.match(await page.locator("#review-state").innerText(), /未完成/);
  await page.locator("#continue-local").click();
  await auth();
  await page.waitForFunction(() =>
    document.querySelector("#output").value.includes("続きの説明と結論"),
  );
  assert.equal(calls, 2);
  assert.equal(
    await page.locator("#output").inputValue(),
    "STEP 4：手順の途続きの説明と結論。",
  );
  assert.match(
    await page.locator("#review-state").innerText(),
    /全体の完成確認/,
  );
  await page
    .getByRole("button", { name: "全文の補完完了を確認", exact: true })
    .click();
  await page.locator("#approve").click();
  assert.match(await page.locator("#review-state").innerText(), /確認済み/);
  await page.locator("#cloud-generate").click();
  await page.waitForFunction(() =>
    document.querySelector("#cloud-jobs").textContent.includes("未完成"),
  );
  await page.locator("#cloud-jobs button").first().click();
  assert.match(await page.locator("#review-state").innerText(), /未完成/);
  await page.locator("#approve").click();
  assert.match(
    await page.locator("#status").innerText(),
    /確認済みにできません/,
  );
  await page.locator("#content-generation-mode").selectOption("chapter");
  await page.locator("#content-section").fill("STEP 5");
  await page.locator("#generate").click();
  await page.waitForFunction(() =>
    document.querySelector("#review-state").textContent.includes("章のみ"),
  );
  assert.match(await page.locator("#output").inputValue(), /STEP 5/);
  await page.locator("#output").fill("利用者が全文を補完しました。");
  await page.locator("#approve").click();
  assert.match(
    await page.locator("#status").innerText(),
    /確認済みにできません/,
  );
  await page.locator("#manual-complete").click();
  assert.match(
    await page.locator("#generation-status").innerText(),
    /手動補完/,
  );
  await page.locator("#approve").click();
  assert.match(await page.locator("#review-state").innerText(), /確認済み/);
  await page.locator("nav [data-page=research]").click();
  await page.locator("#research-query").fill("AI");
  await page.locator("#research-collect").click();
  await page.waitForSelector(".research-record");
  await page.getByRole("button", { name: "許可ページの本文を取得" }).click();
  await page.waitForFunction(() =>
    document
      .querySelector(".research-record summary")
      .textContent.includes("本文取得済み"),
  );
  assert.equal(
    await page
      .getByRole("button", { name: "利用者確認済み（解除）", exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("button", { name: "内容・出典を確認済みにする", exact: true })
    .click();
  await page.locator(".research-record input[type=checkbox]").check();
  await page.locator("#research-to-content").click();
  await page.waitForSelector("#content-evidence");
  await page.locator("#content-generation-mode").selectOption("full");
  await page.locator("#generate").click();
  await page.waitForFunction(() =>
    document.querySelector("#output").value.includes("AIへ提供した本文の範囲"),
  );
  assert.doesNotMatch(
    lastPrompt,
    /記事本文・商品仕様は未取得|RSS見出しのみ取得/,
  );
  assert.match(lastPrompt, /取得本文.*先頭700文字のみ/);
  assert.match(lastPrompt, /本文取得状態：取得済み/);
  assert.match(lastPrompt, /2026-11-10T02:00:01Z/);
  await page.locator("nav [data-page=research]").click();
  await page.getByRole("button", { name: "許可ページの本文を取得" }).click();
  await page.waitForFunction(() =>
    document
      .querySelector(".research-record summary")
      .textContent.includes("02:00:02"),
  );
  await page.locator("nav [data-page=content]").click();
  assert.match(
    await page.locator("#content-evidence-warning").innerText(),
    /更新・削除/,
  );
  const before = calls;
  await page.locator("#generate").click();
  assert.equal(calls, before);
  assert.match(await page.locator("#status").innerText(), /再確認/);
  await page.locator("nav [data-page=research]").click();
  await page
    .getByRole("button", { name: "内容・出典を確認済みにする", exact: true })
    .click();
  await page.locator("#research-to-content").click();
  await page.waitForSelector("#content-evidence");
  assert.equal(
    await page.locator("#content-evidence-warning").isVisible(),
    false,
  );
  await page.locator("#generate").click();
  await page.waitForFunction(() =>
    document.querySelector("#output").value.includes("02:00:02"),
  );
  assert.match(lastPrompt, /2026-11-10T02:00:02Z/);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  }
  await page.locator("nav [data-page=finance]").click();
  assert.equal(
    await page.locator("#content-generation-tools").isVisible(),
    false,
  );
  assert.equal(
    await page.locator("#content-continue-tools").isVisible(),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: incomplete/usage UI, local and cloud reload, guarded review, explicit continuation, chapter scope, manual completion, correct acquired evidence and stale handoff blocking; three widths and other department unchanged",
  );
} finally {
  await browser.close();
}
