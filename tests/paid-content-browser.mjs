import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { article, evidence } from "./paid-fixture.js";
import {
  composeResult,
  normalizeResult,
  generationOptions,
} from "../lib/generation.js";
import { inspectPaid, renderPaidSources } from "../lib/paid-content.js";
const { chromium } = createRequire("/workspace/jarvis-tools/package.json")(
  "playwright",
);
const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let saved = [],
    calls = 0;
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    if (req.method() === "GET")
      return route.fulfill({
        json: req.url().includes("paid-drafts")
          ? { drafts: saved }
          : { jobs: [] },
      });
    const b = req.postDataJSON();
    if (req.url().includes("paid-drafts")) {
      const p = inspectPaid(b.text, b.evidence, { id: b.id });
      const generation = { ...b.generation, project: p };
      p.humanReview = {
        status: b.approved && !p.missing.length ? "approved" : "pending",
      };
      const d = {
        id: b.id,
        topic: b.topic,
        output: renderPaidSources(b.text, p),
        generation,
      };
      saved = [d];
      return route.fulfill({ json: d });
    }
    calls++;
    const r = composeResult(
      normalizeResult(
        {
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: "## 無料部分\n紹介\n## 有料部分\nテンプレートは販売予定です。",
            },
          ],
        },
        "anthropic",
        "mock",
      ),
      generationOptions(b.generation),
    );
    return route.fulfill({
      json: { answer: r.body, generation: r.generation },
    });
  });
  await page.goto(
    (process.env.BASE_URL || "http://localhost:8091") + "/#content",
  );
  await page.locator("#topic").fill("有料記事テスト");
  await page.locator("#format").selectOption("note有料記事");
  await page.locator("#generate").click();
  await page.locator("#password").fill("test");
  await page.locator("#auth-form button.primary").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#paid-content-status")
      .textContent.includes("完成テンプレート"),
  );
  await page.locator("#manual-complete").click();
  assert.match(await page.locator("#status").innerText(), /不足/);
  await page.locator("#approve").click();
  assert.doesNotMatch(
    await page.locator("#review-state").innerText(),
    /^確認済み/,
  );
  // A user fills in the actual deliverables. No model call is made for validation or save.
  await page.locator("#output").fill(article.replace("[R1]", ""));
  await page.locator("#manual-complete").click();
  assert.match(
    await page.locator("#generation-status").innerText(),
    /手動補完/,
  );
  await page.locator("#approve").click();
  assert.match(await page.locator("#review-state").innerText(), /^確認済み/);
  await page.locator("#save-draft").click();
  await page.reload();
  await page
    .locator("#drafts button")
    .getByText("開く", { exact: true })
    .first()
    .click();
  assert.match(await page.locator("#review-state").innerText(), /^確認済み/);
  await page.locator("#save-paid-cloud").click();
  await page.locator("#password").fill("test");
  await page.locator("#auth-form button.primary").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#cloud-jobs")
      .textContent.includes("有料記事テスト"),
  );
  await page
    .locator("#cloud-jobs button")
    .getByText("開く", { exact: true })
    .first()
    .click();
  assert.match(await page.locator("#review-state").innerText(), /^確認済み/);
  assert.equal(await page.locator("#format").inputValue(), "note有料記事");
  assert.equal(calls, 1);
  await page.locator("#output").fill("旧原稿を保持。販売予定。");
  await page.locator("#save-draft").click();
  await page.locator("#manual-complete").click();
  assert.match(await page.locator("#status").innerText(), /不足/);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
  }
  await page.evaluate(() =>
    localStorage.setItem(
      "jarvis_business_drafts_v1",
      JSON.stringify([
        {
          topic: "旧有料原稿",
          format: "note有料記事",
          department: "content",
          text: "削除してはいけない旧原稿",
          approved: true,
          generation: {
            articleStatus: "complete",
            completionStatus: "complete",
            mode: "full",
          },
        },
      ]),
    ),
  );
  await page.reload();
  await page
    .locator("#drafts button")
    .getByText("開く", { exact: true })
    .first()
    .click();
  assert.equal(
    await page.locator("#output").inputValue(),
    "削除してはいけない旧原稿",
  );
  assert.doesNotMatch(
    await page.locator("#review-state").innerText(),
    /^確認済み/,
  );
  assert.match(
    await page.locator("#paid-content-status").innerText(),
    /未完成/,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: paid artifact deficiencies, no manual bypass, explicit review, local/cloud restore, no extra AI, 3 widths",
  );
} finally {
  await browser.close();
}
