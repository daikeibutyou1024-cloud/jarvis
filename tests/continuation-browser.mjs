import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  normalizeResult,
  composeResult,
  generationOptions,
  generationPrompt,
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
  let next = "normal",
    calls = 0,
    jobs = [];
  const title = "AIの実践ガイド";
  const middle = Array.from(
    { length: 280 },
    (_, i) => `資料${i}：判断の根拠を照合する手順を記録します。`,
  ).join("");
  const boundary =
    "入力条件を整理し、照合すべき資料とその根拠を確認してください。".repeat(3);
  const initial = `# ${title}\n## 無料部分\n導入。\n## 有料部分\n### STEP 1 準備\n${middle}\n### STEP 2 実践\n${boundary}`;
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    if (req.headers()["x-jarvis-password"] !== "test")
      return route.fulfill({ status: 401, json: { error: "認証失敗" } });
    if (req.method() === "GET") return route.fulfill({ json: { jobs } });
    calls++;
    const payload = req.postDataJSON(),
      o = generationOptions(payload.generation);
    let text = initial,
      reason = "max_tokens";
    if (o.mode === "continue") {
      const prompt = generationPrompt(payload.prompt || "通常指示", o);
      assert.doesNotMatch(prompt, /指定形式の完成原稿を作成/);
      assert.match(prompt, new RegExp(title));
      assert.match(prompt, /completedSectionIds/);
      assert.match(prompt, /STEP 2 実践/);
      assert.equal(o.previous.includes("--- 入力された調査資料"), false);
      text =
        next === "title"
          ? `# ${title}\n## 無料部分\n再生成`
          : next === "chapter"
            ? "### STEP 1 新しい説明\n再掲"
            : next === "newline"
              ? boundary.replaceAll("、", "、\n") + "続き"
              : next === "long"
                ? "説明を追加。" + middle.slice(400, 1000)
                : next === "max"
                  ? "その結果を使い、追加の検証を"
                  : "実施します。\n\n### STEP 3 結論\n出典と手順を確認してください。";
      reason = next === "max" ? "max_tokens" : "end_turn";
    }
    try {
      const r = composeResult(
        normalizeResult(
          {
            stop_reason: reason,
            usage: {
              input_tokens: 1500,
              output_tokens: reason === "max_tokens" ? 2500 : 300,
            },
            content: [{ type: "text", text }],
          },
          "anthropic",
          "model",
        ),
        o,
      );
      if (req.url().endsWith("/chat"))
        return route.fulfill({
          json: { answer: r.body, generation: r.generation },
        });
      const row = {
        id: String(calls),
        job_type: "content_draft",
        topic: title,
        status: "draft",
        output: r.body,
        generation: r.generation,
        created_at: "2026-11-10 00:00:00",
      };
      jobs = [row, ...jobs];
      return route.fulfill({ status: 201, json: row });
    } catch (error) {
      assert.equal(error.code, "INVALID_CONTINUATION");
      if (!req.url().endsWith("/chat"))
        jobs = [
          {
            id: String(calls),
            job_type: "content_draft",
            topic: title,
            status: "failed",
            output: null,
            error: error.message,
            generation: error.generation,
          },
          ...jobs,
        ];
      return route.fulfill({
        status: 409,
        json: {
          error: error.message,
          code: error.code,
          generation: error.generation,
        },
      });
    }
  });
  await page.goto(
    (process.env.BASE_URL || "http://localhost:8080") + "/#content",
  );
  await page.locator("#topic").fill(title);
  await page.locator("#format").selectOption("note無料記事");
  await page.locator("#generate").click();
  await page.locator("#password").fill("test");
  await page.locator("#auth-form button.primary").click();
  await page.waitForFunction(
    () => document.querySelector("#output").value.length > 5000,
  );
  assert.equal(await page.locator("#output").inputValue(), initial);
  await page.locator("#save-draft").click();
  const saved = await page.evaluate(() =>
    localStorage.getItem("jarvis_business_drafts_v1"),
  );
  for (const scenario of ["title", "chapter", "newline", "long"]) {
    next = scenario;
    const before = calls;
    await page.locator("#continue-local").click();
    await page.waitForFunction(() =>
      document.querySelector("#status").textContent.includes("結合を停止"),
    );
    assert.equal(calls, before + 1);
    assert.equal(await page.locator("#output").inputValue(), initial);
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("jarvis_business_drafts_v1"),
      ),
      saved,
    );
    assert.match(await page.locator("#review-state").innerText(), /未完成/);
  }
  next = "max";
  await page.locator("#continue-local").click();
  await page.waitForFunction(() =>
    document.querySelector("#output").value.endsWith("追加の検証を"),
  );
  assert.match(await page.locator("#review-state").innerText(), /未完成/);
  assert.match(
    await page.locator("#generation-status").innerText(),
    /max_tokens/,
  );
  next = "normal";
  await page.locator("#continue-local").click();
  await page.waitForFunction(() =>
    document.querySelector("#output").value.endsWith("確認してください。"),
  );
  assert.equal(
    (await page.locator("#output").inputValue()).split("# " + title).length - 1,
    1,
  );
  assert.match(
    await page.locator("#review-state").innerText(),
    /全体の完成確認/,
  );
  await page.locator("#approve").click();
  assert.match(
    await page.locator("#status").innerText(),
    /確認済みにできません/,
  );
  await page.locator("#save-draft").click();
  await page.reload();
  await page
    .locator("#drafts button")
    .getByText("開く", { exact: true })
    .first()
    .click();
  assert.match(
    await page.locator("#review-state").innerText(),
    /全体の完成確認/,
  );
  await page.locator("#cloud-generate").click();
  await page.locator("#password").fill("test");
  await page.locator("#auth-form button.primary").click();
  await page.waitForFunction(() =>
    document.querySelector("#cloud-jobs").textContent.includes("未完成"),
  );
  next = "title";
  const before = calls;
  await page.locator("#continue-cloud").click();
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("結合を停止"),
  );
  assert.equal(calls, before + 1);
  assert.equal(await page.locator("#output").inputValue(), initial);
  assert.equal(jobs[0].status, "failed");
  assert.equal(jobs[0].output, null);
  assert.equal(jobs[1].output, initial);
  await page.locator("#cloud-refresh").click();
  await page.waitForFunction(() =>
    document.querySelector("#cloud-jobs").textContent.includes("failed"),
  );
  assert.equal(
    await page.locator("#cloud-jobs button").first().isDisabled(),
    true,
  );
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: restart/chapter/newline/long duplicate errors preserve draft and saved data, no automatic retries, repeated max_tokens resume, whole-article review, local/cloud storage and 3 widths",
  );
} finally {
  await browser.close();
}
