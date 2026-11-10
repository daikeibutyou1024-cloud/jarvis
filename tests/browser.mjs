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
  let posts = 0,
    cloudBody;
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    if (req.headers()["x-jarvis-password"] !== "test")
      return route.fulfill({
        status: 401,
        json: { error: "パスワードが違います" },
      });
    if (req.url().endsWith("/chat")) {
      posts++;
      return route.fulfill({
        json: { answer: "検証用のAI下書き <script>alert(1)</script>" },
      });
    }
    if (req.method() === "POST") {
      cloudBody = req.postDataJSON();
      return route.fulfill({
        status: 201,
        json: { output: "クラウド保存の検証原稿", id: "1", status: "draft" },
      });
    }
    return route.fulfill({
      json: {
        jobs: [
          {
            id: "1",
            job_type: "content_draft",
            topic: "AI活用",
            status: "draft",
            output: "クラウド保存の検証原稿",
            created_at: "2026-11-09 00:00:00",
          },
        ],
      },
    });
  });
  await page.addInitScript(() => {
    window.SpeechRecognition = class {
      start() {
        this.onstart?.();
        this.onresult?.({ results: [[{ transcript: "音声入力の検証" }]] });
        this.onend?.();
      }
      stop() {
        this.onend?.();
      }
    };
  });
  await page.goto((process.env.BASE_URL || "http://localhost:8080"));
  await page.waitForSelector(".dept-card");
  assert.equal(posts, 0);
  await page.locator("#orb-voice").click();
  assert.equal(await page.locator("#command").inputValue(), "音声入力の検証");
  assert.equal(posts, 0, "voice input must not send automatically");
  await page.locator("#command").fill("");
  assert.equal(await page.locator(".dept-card").count(), 5);
  await page.getByRole("button", { name: "リサーチから始める" }).click();
  await page.locator("#topic").fill("AI活用");
  await page.locator("#audience").fill("初心者");
  await page.locator("#generate").click();
  await page.locator("#password").fill("test");
  await page.locator("#auth-form button.primary").click();
  await page.waitForFunction(() =>
    document.querySelector("#output").value.includes("検証用"),
  );
  assert.equal(posts, 1);
  assert.match(await page.locator("#output").inputValue(), /<script>/);
  await page.locator("#approve").click();
  await page.locator("#save-draft").click();
  assert.match(await page.locator("#drafts").innerText(), /確認済み/);
  await page.locator("#output").fill("手動編集");
  assert.match(await page.locator("#review-state").innerText(), /要確認/);
  await page.locator("#handoff").click();
  assert.match(await page.locator("#notes").inputValue(), /RESEARCH/);
  assert.match(await page.locator("#dept-label").innerText(), /CONTENT/);
  await page.locator('nav [data-page="content"]').click();
  assert.equal(await page.locator("#topic").inputValue(), "AI活用");
  await page.locator("#format").selectOption("X投稿");
  await page.locator("#cloud-generate").click();
  await page.waitForFunction(
    () => document.querySelector("#db-status").textContent === "取得成功",
  );
  assert.equal(cloudBody.format, "X投稿");
  assert.equal(cloudBody.department, "content");
  await page.locator("#cloud-jobs button").click();
  assert.equal(
    await page.locator("#output").inputValue(),
    "クラウド保存の検証原稿",
  );
  await page.locator('nav [data-page="analytics"]').click();
  for (const [name, value] of Object.entries({
    visits: "1000",
    clicks: "100",
    conversions: "5",
  }))
    await page.locator(`#metrics-form [name=${name}]`).fill(value);
  await page.locator("#metrics-form button").click();
  assert.match(await page.locator("#metrics-report").innerText(), /10.00%/);
  assert.match(await page.locator("#metrics-report").innerText(), /5.00%/);
  await page.locator('nav [data-page="finance"]').click();
  for (const [type, amount] of [
    ["revenue", "10000"],
    ["expense", "2000"],
    ["api", "500"],
  ]) {
    await page.locator("#finance-form [name=type]").selectOption(type);
    await page.locator("#finance-form [name=amount]").fill(amount);
    await page.locator("#finance-form [name=memo]").fill(type);
    await page.locator("#finance-form button").click();
  }
  assert.match(await page.locator("#finance-report").innerText(), /7,500/);
  assert.equal(await page.locator("#ledger tr").count(), 3);
  await page.locator("#command").fill("改善案を教えて");
  await page.locator("#send-command").click();
  await page.waitForSelector(".message.assistant");
  assert.equal(await page.locator("#conversation script").count(), 0);
  await page.reload();
  await page.waitForSelector(".dept-card", { state: "attached" });
  assert.match(await page.locator("#finance-report").innerText(), /7,500/);
  assert.match(await page.locator("#drafts").innerText(), /確認済み/);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("jarvis_access_password")),
    null,
  );
  await page.locator('nav [data-page="overview"]').click();
  await page.screenshot({ path: "work/desktop.png", fullPage: true });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const dept of [
      "overview",
      "research",
      "content",
      "marketing",
      "analytics",
      "finance",
    ]) {
      await page.locator(`nav [data-page="${dept}"]`).click();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `overflow ${width} ${dept}`,
      );
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('nav [data-page="overview"]').click();
  await page.screenshot({ path: "work/mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: 5 departments, auth, AI, cloud, drafts, review, analytics, finance, chat, persistence, 3 viewport sizes; no browser errors.",
  );
} finally {
  await browser.close();
}
