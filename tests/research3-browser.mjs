import assert from "node:assert/strict";
import { createRequire } from "node:module";
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
  let prompt = "",
    proposalBody,
    bodyFail = false,
    ideaCalls = 0;
  const record = {
    id: "rss1",
    title: "AI公式記事",
    text: "配信要約",
    sourceUrl:
      "https://www.digital.go.jp/policies/genai/aff58345-cef0-433c-8b33-88217fe0b423",
    fetchedAt: "2026-11-10T01:00:00Z",
    recordedAt: "2026-11-10T01:00:00Z",
    kind: "fact",
    verification: "source_observed",
    origin: "digital",
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
          items: [record],
          fetchedAt: record.fetchedAt,
          cached: false,
        },
      });
    if (req.url().includes("/research/article"))
      return route.fulfill({
        json: bodyFail
          ? {
              status: "unavailable",
              fetchedAt: null,
              error: "robots.txtで取得できません",
            }
          : {
              status: "acquired",
              text: "本文の公式説明。".repeat(100),
              fetchedAt: "2026-11-10T02:00:00Z",
              truncated: false,
            },
      });
    if (req.url().endsWith("/research/ideas")) {
      ideaCalls++;
      proposalBody = req.postDataJSON();
      const r = proposalBody.records[0];
      return route.fulfill({
        json: {
          ideas: ["note_free", "note_paid", "affiliate"].map((format, i) => ({
            id: "plan" + i,
            title: ["初心者向けAI導入", "AI選定テンプレート", "商品の比較手順"][
              i
            ],
            reader: "初心者の悩み（仮説）",
            angle: "差別化の仮説",
            format,
            reason: "形式に合う価値の仮説",
            sourceIds: [r.id],
            evidence: [r],
            classification: "ai_hypothesis",
            createdAt: "2026-11-10T03:00:00Z",
            scores: Object.fromEntries(
              ["demand", "differentiation", "monetization", "evidence"].map(
                (k) => [k, { score: 3, reason: "実測は未取得・AI仮説" }],
              ),
            ),
          })),
        },
      });
    }
    if (req.url().endsWith("/chat")) {
      prompt = req.postDataJSON().prompt;
      return route.fulfill({
        json: { answer: "記事下書き。出典を確認してください。" },
      });
    }
    return route.fulfill({ json: { jobs: [] } });
  });
  await page.goto(
    (process.env.BASE_URL || "http://localhost:8080") + "/#research",
  );
  await page.locator("#topic").fill("AIと商品比較");
  await page.locator("#research-query").fill("AI");
  await page.locator("#research-collect").click();
  await page.locator("#password").fill("test");
  await page.locator("#auth-form button.primary").click();
  await page.waitForSelector(".research-record");
  await page.locator(".research-record input[type=checkbox]").check();
  await page.locator("#research-propose").click();
  assert.equal(ideaCalls, 0);
  assert.match(await page.locator("#status").innerText(), /確認済み/);
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
  assert.equal(
    await page
      .getByRole("button", { name: "内容・出典を確認済みにする", exact: true })
      .count(),
    1,
  );
  await page.locator(".research-record summary").click();
  assert.match(
    await page.locator(".research-record").innerText(),
    /2026-11-10T02:00:00Z/,
  );
  await page
    .getByRole("button", { name: "内容・出典を確認済みにする" })
    .click();
  await page.locator("#research-propose").click();
  await page.waitForFunction(
    () => document.querySelectorAll("#research-plans article").length === 3,
  );
  assert.equal(ideaCalls, 1);
  assert.equal(proposalBody.records[0].bodyText.length, 700);
  assert.match(
    await page.locator("#research-plans").innerText(),
    /AI仮説・実測ではない/,
  );
  assert.match(
    await page.locator("#research-plans").innerText(),
    /価格・売上・報酬額.*未取得/,
  );
  await page
    .locator("#research-plans article")
    .nth(1)
    .getByRole("button")
    .click();
  await page.waitForSelector("#content-evidence");
  assert.equal(await page.locator("#topic").inputValue(), "AI選定テンプレート");
  assert.equal(await page.locator("#format").inputValue(), "note有料記事");
  assert.match(await page.locator("#content-plan").innerText(), /AI仮説/);
  await page.locator("#generate").click();
  await page.waitForFunction(() =>
    document.querySelector("#output").value.includes("入力された調査資料"),
  );
  assert.match(prompt, /AI選定テンプレート/);
  assert.match(prompt, /本文取得日時：2026-11-10T02:00:00Z/);
  assert.match(
    prompt,
    /https:\/\/www.digital.go.jp\/policies\/genai\/aff58345-cef0-433c-8b33-88217fe0b423/,
  );
  assert.match(prompt, /利用者確認日時/);
  assert.match(prompt, /note有料記事/);
  await page.reload();
  await page.waitForSelector("#content-evidence");
  assert.equal(await page.locator("#topic").inputValue(), "AI選定テンプレート");
  assert.match(
    await page.locator("#content-plan").innerText(),
    /AI選定テンプレート/,
  );
  await page.locator("nav [data-page=research]").click();
  bodyFail = true;
  await page.getByRole("button", { name: "許可ページの本文を取得" }).click();
  await page.locator("#password").fill("test");
  await page.locator("#auth-form button.primary").click();
  await page.waitForFunction(() =>
    document
      .querySelector(".research-record summary")
      .textContent.includes("未取得"),
  );
  assert.equal(
    await page
      .getByRole("button", { name: "内容・出典を確認済みにする" })
      .count(),
    1,
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
  await page.screenshot({ path: "work/research3-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "work/research3-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: body status/provenance, review gate, three AI-hypothesis formats, plan and confirmed evidence handoff, paid-note generation, persistence, failed-refetch invalidation, 3 widths",
  );
} finally {
  await browser.close();
}
