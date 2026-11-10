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
  let collected = 0,
    prompt = "",
    cloudBody,
    fail = false;
  const external = {
    id: "digital:1",
    title: "AI政策のお知らせ",
    text: "官公庁RSSに掲載された情報",
    sourceUrl: "https://www.digital.go.jp/news/test",
    fetchedAt: "2026-11-10T01:00:00Z",
    recordedAt: "2026-11-10T01:00:00Z",
    kind: "fact",
    origin: "digital",
    verification: "source_observed",
    status: "acquired",
    price: "",
    affiliate: "",
  };
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    if (req.headers()["x-jarvis-password"] !== "test")
      return route.fulfill({ status: 401, json: { error: "認証失敗" } });
    if (req.url().includes("/research/collect")) {
      collected++;
      return route.fulfill(
        fail
          ? {
              status: 429,
              json: {
                status: "unavailable",
                label: "未取得",
                items: [],
                error: "回数制限",
              },
            }
          : {
              json: {
                status: "acquired",
                label: "取得済み",
                fetchedAt: external.fetchedAt,
                cached: false,
                items: [external],
                scope: "RSS配信範囲",
              },
            },
      );
    }
    if (req.url().endsWith("/chat")) {
      prompt = req.postDataJSON().prompt;
      return route.fulfill({
        json: { answer: "AIによる記事の下書き・要確認" },
      });
    }
    if (req.method() === "POST") {
      cloudBody = req.postDataJSON();
      return route.fulfill({
        status: 201,
        json: { output: "クラウド原稿\n" + cloudBody.context, status: "draft" },
      });
    }
    return route.fulfill({ json: { jobs: [] } });
  });
  await page.goto("http://localhost:8080/#research");
  await page.waitForSelector("#research-tools");
  assert.equal(collected, 0);
  assert.match(await page.locator("#research-status").innerText(), /未取得/);
  await page.locator("#topic").fill("AI活用と副業");
  await page.locator("#research-query").fill("AI");
  await page.locator("#research-collect").click();
  await page.locator("#password").fill("test");
  await page.locator("#auth-form button.primary").click();
  await page.waitForSelector(".research-record");
  assert.match(
    await page.locator("#research-records").innerText(),
    /2026-11-10T01:00:00Z/,
  );
  assert.match(
    await page.locator("#research-records").innerText(),
    /価格：未取得/,
  );
  // JSON cannot forge acquired metadata or execute markup.
  await page
    .locator("#research-tools details")
    .nth(1)
    .locator("summary")
    .click();
  await page
    .locator("#research-import")
    .setInputFiles({
      name: "compare.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify([
          {
            title: "比較サービス",
            text: "<img src=x onerror=alert(1)>特徴メモ",
            sourceUrl: "https://example.com/service",
            price: "月額0円（利用者記録）",
            fetchedAt: "1999-01-01",
            verification: "source_observed",
          },
        ]),
      ),
    });
  await page.waitForFunction(
    () => document.querySelectorAll(".research-record").length === 2,
  );
  assert.equal(await page.locator("#research-records img").count(), 0);
  assert.match(await page.locator("#research-records").innerText(), /未検証/);
  assert.doesNotMatch(
    await page.locator("#research-records").innerText(),
    /1999-01-01/,
  );
  const before = await page.locator(".research-record").count();
  await page
    .locator("#research-import")
    .setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        '[{"title":"bad","text":"bad","sourceUrl":"http://127.0.0.1"}]',
      ),
    });
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("取り込み失敗"),
  );
  assert.equal(await page.locator(".research-record").count(), before);
  await page
    .locator("#research-tools details")
    .nth(0)
    .locator("summary")
    .click();
  await page.locator("#research-manual-form [name=title]").fill("収益化の仮説");
  await page
    .locator("#research-manual-form [name=text]")
    .fill("利用者の仮説。成果は未取得。");
  await page
    .locator("#research-manual-form [name=kind]")
    .selectOption("hypothesis");
  await page.locator("#research-manual-form button").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".research-record").length === 3,
  );
  for (const checkbox of await page
    .locator(".research-record input[type=checkbox]")
    .all())
    await checkbox.check();
  await page.locator("#research-to-content").click();
  await page.waitForSelector("#content-evidence");
  assert.match(
    await page.locator("#content-evidence-list").innerText(),
    /仮説/,
  );
  assert.equal(await page.locator("#content-evidence-list li").count(), 3);
  await page.locator("#generate").click();
  await page.waitForFunction(() =>
    document.querySelector("#output").value.includes("入力された調査資料"),
  );
  assert.match(prompt, /RESEARCH 2.0/);
  assert.match(prompt, /https:\/\/www.digital.go.jp\/news\/test/);
  assert.match(prompt, /未検証/);
  assert.match(
    await page.locator("#output").inputValue(),
    /取得日時：2026-11-10T01:00:00Z/,
  );
  await page.locator("#save-draft").click();
  assert.match(await page.locator("#drafts").innerText(), /AI活用と副業/);
  await page.locator("#cloud-generate").click();
  await page.waitForFunction(
    () => document.querySelector("#db-status").textContent === "取得成功",
  );
  assert.match(cloudBody.context, /RESEARCH 2.0/);
  await page.reload();
  await page.waitForSelector("#content-evidence");
  assert.equal(await page.locator("#content-evidence-list li").count(), 3);
  await page.locator("nav [data-page=research]").click();
  assert.equal(await page.locator(".research-record").count(), 3);
  fail = true;
  await page.locator("#research-query").fill("再取得");
  await page.locator("#research-collect").click();
  await page.locator("#password").fill("test");
  await page.locator("#auth-form button.primary").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#research-status")
      .textContent.includes("未取得：回数制限"),
  );
  assert.equal(await page.locator(".research-record").count(), 3);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      "research overflow " + width,
    );
    await page.locator("nav [data-page=content]").click();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      "content overflow " + width,
    );
    await page.locator("nav [data-page=research]").click();
  }
  await page.screenshot({ path: "work/research-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "work/research-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: RESEARCH collection, explicit unavailable state, safe imports, classification, source timestamps, CONTENT/Claude handoff, cloud context, persistence and three viewport sizes",
  );
} finally {
  await browser.close();
}
