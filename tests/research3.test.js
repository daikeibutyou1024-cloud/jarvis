import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  articleURL,
  robotsAllows,
  extractArticle,
  fetchPublic,
} from "../lib/article.js";
import { reserveAI } from "../lib/ai-quota.js";
import {
  validateEvidence,
  validateIdeas,
  ideaPrompt,
} from "../lib/research-ideas.js";
import { onRequestGet as article } from "../functions/api/research/article.js";
import { onRequestPost as ideas } from "../functions/api/research/ideas.js";
import { onRequestPost as chat } from "../functions/api/chat.js";
import { SCHEMA } from "../functions/api/research/collect.js";
function d1() {
  const db = new DatabaseSync(":memory:");
  return {
    db,
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
            meta: {
              changes: Number(db.prepare(sql).run(...this.args).changes),
            },
          };
        },
      };
    },
    async batch(ss) {
      return Promise.all(ss.map((s) => s.run()));
    },
  };
}
const html =
  "<html><head><script>BAD_SCRIPT</script></head><body><nav>BAD_NAV</nav><main><h1>公式情報</h1><p>" +
  "実際の本文と公式な説明。".repeat(15) +
  '</p><script>BAD_INLINE</script><div hidden>BAD_HIDDEN</div><img src="http://127.0.0.1/x"><iframe src="http://localhost"></iframe></main><footer>BAD_FOOTER</footer></body></html>';
const record = {
  id: "source1",
  title: "公式資料",
  text: "公式に記載された情報",
  sourceUrl: "https://www.digital.go.jp/news/test",
  fetchedAt: "2026-11-10T00:00:00Z",
  kind: "fact",
  reviewedAt: "2026-11-10T01:00:00Z",
};
const proposed = {
  title: "初心者のAI選びの手順",
  reader: "選び方に迷う人という仮説",
  angle: "確認手順を比較する仮説",
  format: "note_paid",
  reason: "独自テンプレートの価値を検証する",
  sourceIds: ["source1"],
  scores: Object.fromEntries(
    ["demand", "differentiation", "monetization", "evidence"].map((k) => [
      k,
      { score: 3, reason: "資料をもとにしたAI仮説。実測は未取得" },
    ]),
  ),
};
function env(db) {
  return {
    JARVIS_DB: db,
    JARVIS_ACCESS_PASSWORD: "test",
    ANTHROPIC_API_KEY: "fake",
  };
}
const pageReq = (
  url = "https://www.digital.go.jp/news/test",
  password = "test",
) =>
  new Request(
    "http://localhost/api/research/article?" + new URLSearchParams({ url }),
    { headers: { "x-jarvis-password": password } },
  );
const ideaReq = (body) =>
  new Request("http://localhost/api/research/ideas", {
    method: "POST",
    headers: {
      "x-jarvis-password": "test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
async function seeded() {
  const db = d1();
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  db.db
    .prepare("INSERT INTO research_cache VALUES(?,?,?)")
    .run(
      "digital",
      JSON.stringify({ status: "acquired", items: [record] }),
      Math.floor(Date.now() / 1000) + 3600,
    );
  return db;
}
test("article URLs reject SSRF vectors, arbitrary paths, userinfo, ports and downloads", () => {
  assert.equal(articleURL(record.sourceUrl).hostname, "www.digital.go.jp");
  for (const url of [
    "http://www.digital.go.jp/news/test",
    "https://www.digital.go.jp.evil.example/news/test",
    "https://127.0.0.1/news/x",
    "https://[::1]/news/x",
    "https://www.digital.go.jp:444/news/x",
    "https://user@www.digital.go.jp/news/x",
    "https://www.digital.go.jp/api/test",
    "https://www.digital.go.jp/news/test?url=http://localhost",
    "https://www.digital.go.jp/news/test.pdf",
    "https://www.digital.go.jp/news/%2fadmin",
  ])
    assert.throws(() => articleURL(url), url);
});
test("HTML extraction never executes/follows scripts or links, excludes non-content and caps output", () => {
  const r = extractArticle(html);
  assert.match(r.text, /公式情報/);
  assert.doesNotMatch(r.text, /BAD_|127.0.0.1/);
  assert.equal(
    extractArticle("<main>" + "x".repeat(13000) + "</main>").text.length,
    12000,
  );
  assert.equal(
    extractArticle("<main>" + "x".repeat(13000) + "</main>").truncated,
    true,
  );
  assert.throws(() => extractArticle("<body>body only</body>"));
  assert.throws(() => extractArticle("<main>short</main>"));
});
test("robots respects matching agent, longest rule, wildcard and allow override", () => {
  assert.equal(
    robotsAllows("User-agent: *\nDisallow: /news/", "/news/test"),
    false,
  );
  assert.equal(
    robotsAllows(
      "User-agent: *\nDisallow: /news/\nAllow: /news/test",
      "/news/test",
    ),
    true,
  );
  assert.equal(
    robotsAllows(
      "User-agent: *\nAllow: /\nUser-agent: JARVIS-Research\nDisallow: /",
      "/news/test",
    ),
    false,
  );
  assert.equal(
    robotsAllows(
      "User-agent: *\nDisallow: /*.html$",
      "/notice/entry/test.html",
    ),
    false,
  );
});
test("page network refuses redirects, non-HTML, excess size; does not send secret", async () => {
  await assert.rejects(
    fetchPublic(record.sourceUrl, {
      fetcher: async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "http://localhost" },
        }),
    }),
    /リダイレクト/,
  );
  await assert.rejects(
    fetchPublic(record.sourceUrl, {
      fetcher: async () =>
        new Response("{}", { headers: { "Content-Type": "application/json" } }),
    }),
    /形式/,
  );
  await assert.rejects(
    fetchPublic(record.sourceUrl, {
      fetcher: async () =>
        new Response("x".repeat(1000001), {
          headers: { "Content-Type": "text/html" },
        }),
    }),
    /取得量/,
  );
  const r = await fetchPublic(record.sourceUrl, {
    fetcher: async (url, opts) => {
      assert.equal(opts.redirect, "manual");
      assert.equal(opts.headers["x-jarvis-password"], undefined);
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  });
  assert.equal(r.text, html);
});
test("page auth and RSS provenance are mandatory before any outbound request", async () => {
  const db = await seeded(),
    original = fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw Error("no call");
  };
  try {
    assert.equal(
      (
        await article({
          request: pageReq(record.sourceUrl, "wrong"),
          env: env(db),
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await article({
          request: pageReq("https://www.digital.go.jp/news/unlisted"),
          env: env(db),
        })
      ).status,
      400,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
    db.db.close();
  }
});
test("page fetch checks robots, persists body time/cache and blocks robots denial", async () => {
  const db = await seeded(),
    original = fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    return new Response(
      url.endsWith("/robots.txt") ? "User-agent: *\nAllow: /" : html,
      {
        headers: {
          "Content-Type": url.endsWith("/robots.txt")
            ? "text/plain"
            : "text/html",
        },
      },
    );
  };
  try {
    const r = await (
      await article({ request: pageReq(), env: env(db) })
    ).json();
    assert.equal(r.status, "acquired");
    assert.ok(r.fetchedAt);
    assert.equal(r.rssFetchedAt, record.fetchedAt);
    assert.doesNotMatch(r.text, /BAD_/);
    const cached = await (
      await article({ request: pageReq(), env: env(db) })
    ).json();
    assert.equal(cached.cached, true);
    assert.equal(cached.fetchedAt, r.fetchedAt);
    assert.equal(calls, 2);
    db.db.exec("DELETE FROM research_cache WHERE key LIKE 'article:%'");
    db.db
      .prepare("UPDATE research_cache SET payload=? WHERE key=?")
      .run(
        JSON.stringify({ text: "User-agent: *\nDisallow: /" }),
        "robots:https://www.digital.go.jp",
      );
    const blocked = await (
      await article({ request: pageReq(), env: env(db) })
    ).json();
    assert.equal(blocked.status, "unavailable");
    assert.equal(blocked.fetchedAt, null);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
    db.db.close();
  }
});
test("AI quota persists shared UTC limits, special idea cap and concurrent reservations", async () => {
  const db = d1();
  try {
    const e = env(db),
      now = Date.UTC(2026, 10, 10) / 1000;
    assert.equal(await reserveAI(e, "ideas", now), true);
    assert.equal(await reserveAI(e, "ideas", now), true);
    assert.equal(await reserveAI(e, "ideas", now), false);
    for (let i = 0; i < 7; i++)
      assert.equal(await reserveAI(e, "chat", now), true);
    const concurrent = await Promise.all([
      reserveAI(e, "chat", now),
      reserveAI(e, "chat", now),
    ]);
    assert.equal(concurrent.filter(Boolean).length, 1);
    assert.equal(await reserveAI(e, "job", now), false);
    assert.equal(await reserveAI(e, "chat", now + 86400), true);
  } finally {
    db.db.close();
  }
});
test("idea contracts reject unreviewed facts, invented refs, money and non-numeric scores", () => {
  assert.throws(() => validateEvidence([{ ...record, reviewedAt: null }]));
  assert.throws(() => validateEvidence([{ ...record, kind: "hypothesis" }]));
  const evidence = validateEvidence([record]);
  const validated = validateIdeas(
    JSON.stringify({ ideas: [proposed] }),
    evidence,
  )[0];
  assert.equal(validated.classification, "ai_hypothesis");
  for (const s of Object.values(validated.scores))
    assert.equal(s.classification, "ai_hypothesis");
  assert.throws(() =>
    validateIdeas(
      JSON.stringify({ ideas: [{ ...proposed, title: "月収100万円" }] }),
      evidence,
    ),
  );
  assert.throws(() =>
    validateIdeas(
      JSON.stringify({ ideas: [{ ...proposed, sourceIds: ["invented"] }] }),
      evidence,
    ),
  );
  assert.match(ideaPrompt("AI", evidence), /未取得/);
});
test("Claude ideas reserve before charging, store snapshots, and enforce two calls per day", async () => {
  const db = d1(),
    original = fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    assert.match(options.body, /source1/);
    return Response.json({
      content: [{ type: "text", text: JSON.stringify({ ideas: [proposed] }) }],
    });
  };
  try {
    for (let i = 0; i < 2; i++) {
      const r = await ideas({
        request: ideaReq({ topic: "AI", records: [record] }),
        env: env(db),
      });
      assert.equal(r.status, 200);
      const data = await r.json();
      assert.equal(data.ideas[0].evidence[0].fetchedAt, record.fetchedAt);
    }
    assert.equal(
      (
        await ideas({
          request: ideaReq({ topic: "AI", records: [record] }),
          env: env(db),
        })
      ).status,
      429,
    );
    assert.equal(calls, 2);
    assert.equal(
      db.db.prepare("SELECT COUNT(*) AS n FROM research_plans").get().n,
      2,
    );
  } finally {
    globalThis.fetch = original;
    db.db.close();
  }
});
test("normal chat is covered by shared durable limits", async () => {
  const db = d1(),
    original = fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ content: [{ type: "text", text: "回答" }] });
  };
  try {
    for (let i = 0; i < 10; i++) await reserveAI(env(db), "chat");
    const r = await chat({
      request: new Request("http://localhost/api/chat", {
        method: "POST",
        headers: {
          "x-jarvis-password": "test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt: "質問" }),
      }),
      env: env(db),
    });
    assert.equal(r.status, 429);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
    db.db.close();
  }
});

test("paid-note and affiliate drafts request appropriate structure without invented prices", async () => {
  const { buildPrompt } = await import("../assets/business.js");
  assert.match(
    buildPrompt("content", { topic: "AI", format: "note有料記事" }),
    /無料導入と有料部分/,
  );
  assert.match(
    buildPrompt("content", { topic: "AI", format: "アフィリエイト比較記事" }),
    /Amazon等の最新価格.*未取得/,
  );
});

const policyURL =
  "https://www.digital.go.jp/policies/genai/aff58345-cef0-433c-8b33-88217fe0b423";
test("Digital Agency policies URLs are allowed without allowing other hosts or path tricks", () => {
  assert.equal(articleURL(policyURL).href, policyURL);
  assert.equal(
    articleURL("https://www.caa.go.jp/notice/entry/test.html").hostname,
    "www.caa.go.jp",
  );
  for (const raw of [
    policyURL.replace("www.digital.go.jp", "www.caa.go.jp"),
    policyURL.replace("www.digital.go.jp", "www.digital.go.jp.evil.example"),
    policyURL + "?redirect=http://127.0.0.1",
    policyURL + "#fragment",
    policyURL.replace("/genai/", "/%2e%2e/"),
    policyURL.replace("/genai/", "/../policies/genai/"),
    policyURL.replace("/genai/", "//genai/"),
    policyURL + ".pdf",
    "https://www.digital.go.jp/policies-other/test",
    "https://www.digital.go.jp/notice/entry/test",
  ])
    assert.throws(() => articleURL(raw), raw);
});
test("listed policies article passes RSS and robots gates, preserves timestamps and stays unreviewed", async () => {
  const db = await seeded(),
    original = fetch;
  let calls = 0;
  db.db
    .prepare("UPDATE research_cache SET payload=? WHERE key=?")
    .run(
      JSON.stringify({
        status: "acquired",
        items: [{ ...record, sourceUrl: policyURL }],
      }),
      "digital",
    );
  globalThis.fetch = async (url) => {
    calls++;
    assert.ok(
      [policyURL, "https://www.digital.go.jp/robots.txt"].includes(url),
    );
    return new Response(
      url.endsWith("/robots.txt") ? "User-agent: *\nAllow: /policies/" : html,
      {
        headers: {
          "Content-Type": url.endsWith("/robots.txt")
            ? "text/plain"
            : "text/html; charset=utf-8",
        },
      },
    );
  };
  try {
    const unlisted = await article({
      request: pageReq(policyURL + "-not-listed"),
      env: env(db),
    });
    assert.equal(unlisted.status, 400);
    assert.match(
      (await unlisted.json()).error,
      /最新RSSにこのURLが見つかりません/,
    );
    assert.equal(calls, 0);
    const data = await (
      await article({ request: pageReq(policyURL), env: env(db) })
    ).json();
    assert.equal(data.status, "acquired");
    assert.equal(data.sourceUrl, policyURL);
    assert.equal(data.rssFetchedAt, record.fetchedAt);
    assert.ok(data.fetchedAt);
    assert.match(data.label, /未検証/);
    assert.equal(data.reviewedAt, undefined);
    assert.doesNotMatch(data.text, /BAD_/);
    const cache = await (
      await article({ request: pageReq(policyURL), env: env(db) })
    ).json();
    assert.equal(cache.cached, true);
    assert.equal(cache.fetchedAt, data.fetchedAt);
    assert.equal(cache.reviewedAt, undefined);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
    db.db.close();
  }
});
test("policies article failures disclose robots or redirect reasons and never mark acquisition", async () => {
  const original = fetch;
  try {
    for (const reason of ["robots", "redirect"]) {
      const db = await seeded();
      db.db
        .prepare("UPDATE research_cache SET payload=? WHERE key=?")
        .run(
          JSON.stringify({
            status: "acquired",
            items: [{ ...record, sourceUrl: policyURL }],
          }),
          "digital",
        );
      let pageCalls = 0;
      globalThis.fetch = async (url) => {
        if (url.endsWith("/robots.txt"))
          return new Response(
            reason === "robots"
              ? "User-agent: *\nDisallow: /policies/"
              : "User-agent: *\nAllow: /",
            { headers: { "Content-Type": "text/plain" } },
          );
        pageCalls++;
        return new Response(null, {
          status: 302,
          headers: { Location: "http://127.0.0.1/private" },
        });
      };
      try {
        const data = await (
          await article({ request: pageReq(policyURL), env: env(db) })
        ).json();
        assert.equal(data.status, "unavailable");
        assert.equal(data.fetchedAt, null);
        assert.equal(data.reviewedAt, undefined);
        assert.match(
          data.error,
          reason === "robots" ? /robots.txt/ : /リダイレクト/,
        );
        assert.equal(pageCalls, reason === "robots" ? 0 : 1);
      } finally {
        db.db.close();
      }
    }
  } finally {
    globalThis.fetch = original;
  }
});
test("public policies page timeout still aborts the connection", async () => {
  let aborted = false;
  await assert.rejects(
    fetchPublic(policyURL, {
      fetcher: async (_url, { signal }) =>
        new Promise((_, reject) =>
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(Error("aborted"));
          }),
        ),
    }),
    /8秒.*タイムアウト/,
  );
  assert.equal(aborted, true);
});
