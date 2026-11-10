import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  referenceUrl,
  manualRecord,
  importRecords,
  researchPacket,
} from "../assets/research-data.js";
import {
  boundedFetch,
  destination,
  parseRecords,
  onRequestGet,
  MAX_BYTES,
} from "../functions/api/research/collect.js";
const rss =
  '<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><item><title>AI活用のお知らせ</title><link>https://www.digital.go.jp/news/test</link><description><![CDATA[<b>公式</b>配信の要約]]></description><dc:date>2026-11-10</dc:date></item></rdf:RDF>';
const feed = () =>
  new Response(rss, { headers: { "Content-Type": "application/rss+xml" } });
function d1() {
  const db = new DatabaseSync(":memory:");
  return {
    db,
    prepare(sql) {
      return {
        params: [],
        bind(...params) {
          this.params = params;
          return this;
        },
        async first() {
          return db.prepare(sql).get(...this.params) || null;
        },
        async all() {
          return { results: db.prepare(sql).all(...this.params) };
        },
        async run() {
          const result = db.prepare(sql).run(...this.params);
          return { meta: { changes: Number(result.changes) } };
        },
      };
    },
    async batch(stmts) {
      return Promise.all(stmts.map((s) => s.run()));
    },
  };
}
const req = (q = "AI", source = "digital", password = "test", extra = "") =>
  new Request(
    "http://localhost/api/research/collect?" +
      new URLSearchParams({ source, q }) +
      extra,
    { headers: { "x-jarvis-password": password } },
  );
const env = (db) => ({ JARVIS_ACCESS_PASSWORD: "test", JARVIS_DB: db });
test("references reject unsafe URLs and collection destinations are fixed", () => {
  for (const url of [
    "http://example.com",
    "https://127.0.0.1",
    "https://localhost/x",
    "https://[::1]/",
    "javascript:alert(1)",
    "https://a:b@example.com/",
    "https://example.com:8080/",
    "https://x.internal",
  ])
    assert.equal(referenceUrl(url), "");
  assert.ok(referenceUrl("https://example.com/product"));
  assert.equal(
    destination("digital", "AI"),
    "https://www.digital.go.jp/rss/news.xml",
  );
  assert.throws(() => destination("https://attacker.invalid", "AI"));
  assert.match(
    destination("github", "note"),
    /api.github.com\/search\/repositories/,
  );
});
test("RSS1, RSS2, Atom and GitHub preserve source metadata with no inferred price", () => {
  const r = parseRecords(rss, "digital", "2026-11-10T00:00:00Z")[0];
  assert.equal(r.fetchedAt, "2026-11-10T00:00:00Z");
  assert.equal(r.verification, "source_observed");
  assert.equal(r.publishedAt, "2026-11-10");
  assert.equal(r.text, "公式 配信の要約");
  assert.equal(r.price, "");
  assert.equal(
    parseRecords(
      "<rss><channel><item><title>A</title><link>https://www.caa.go.jp/test</link></item></channel></rss>",
      "caa",
    ).length,
    1,
  );
  assert.equal(
    parseRecords(
      '<feed><entry><title>A</title><link href="https://www.digital.go.jp/test" /></entry></feed>',
      "digital",
    ).length,
    1,
  );
  const repos = parseRecords(
    JSON.stringify({
      items: [
        {
          full_name: "a/b",
          html_url: "https://github.com/a/b",
          stargazers_count: 1,
          description: "test",
        },
      ],
    }),
    "github",
  );
  assert.match(repos[0].text, /収益.*保証ではありません/);
  assert.equal(
    parseRecords(
      "<rss><channel><item><title>A</title><link>https://evil.example/a</link></item></channel></rss>",
      "caa",
    ).length,
    0,
  );
  assert.throws(() =>
    parseRecords('{"incomplete_results":true,"items":[]}', "github"),
  );
});
test("DTD, invalid XML and unexpected feed format fail closed", () => {
  assert.throws(() =>
    parseRecords('<!DOCTYPE rss [<!ENTITY x "boom">]><rss/>', "digital"),
  );
  assert.throws(() => parseRecords("<rss><broken>", "digital"));
  assert.throws(() => parseRecords("<html>error</html>", "digital"));
});
test("manual/JSON/CSV imports cannot forge external acquisition or verified facts", () => {
  const record = manualRecord({
    title: "比較商品",
    text: "利用者のメモ",
    sourceUrl: "https://example.com",
    fetchedAt: "2026-01-01",
    verification: "source_observed",
  });
  assert.equal(record.fetchedAt, null);
  assert.equal(record.verification, "manual_unverified");
  const imported = importRecords(
    JSON.stringify([
      {
        title: "サービス",
        text: "料金",
        origin: "digital",
        fetchedAt: "2020-01-01",
        price: "未取得",
      },
    ]),
    "json",
  );
  assert.equal(imported[0].origin, "import");
  assert.equal(imported[0].fetchedAt, null);
  const csv = importRecords(
    'title,text,kind\r\n"商品,比較","改行\nしたメモ",hypothesis',
    "csv",
  );
  assert.equal(csv[0].title, "商品,比較");
  assert.equal(csv[0].kind, "hypothesis");
  assert.throws(() => importRecords('title,text\nA,"broken', "csv"));
  assert.throws(() =>
    importRecords(
      JSON.stringify(
        Array.from({ length: 51 }, () => ({ title: "A", text: "B" })),
      ),
      "json",
    ),
  );
  assert.throws(() => importRecords("x".repeat(100001), "json"));
  assert.throws(() =>
    manualRecord({ title: "A", text: "B", sourceUrl: "javascript:alert(1)" }),
  );
});
test("handoff preserves citations/timestamps and distinguishes hypotheses and missing data", () => {
  const records = [
    parseRecords(rss, "digital")[0],
    manualRecord({
      title: "価格の仮説",
      text: "安いと思う",
      kind: "hypothesis",
    }),
  ];
  const packet = researchPacket(records);
  assert.match(packet, /https:\/\/www.digital.go.jp/);
  assert.match(packet, /仮説/);
  assert.match(packet, /未取得/);
  assert.match(packet, /取得日時/);
  assert.throws(() => researchPacket(Array(6).fill(records[0])));
  assert.throws(() =>
    researchPacket(
      Array(5).fill(manualRecord({ title: "x", text: "x".repeat(1000) })),
    ),
  );
});
test("fetch never forwards auth, never follows redirects and caps MIME/bytes", async () => {
  await boundedFetch(
    destination("digital", "AI"),
    "digital",
    async (url, options) => {
      assert.equal(options.redirect, "manual");
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.headers["x-jarvis-password"], undefined);
      return feed();
    },
  );
  await assert.rejects(
    boundedFetch(
      destination("digital", "AI"),
      "digital",
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "http://127.0.0.1" },
        }),
    ),
    /リダイレクト/,
  );
  await assert.rejects(
    boundedFetch("https://evil.example", "digital", async () => {
      throw Error("must not fetch");
    }),
    /許可/,
  );
  await assert.rejects(
    boundedFetch(
      destination("digital", "AI"),
      "digital",
      async () =>
        new Response("html", { headers: { "Content-Type": "text/html" } }),
    ),
    /形式/,
  );
  await assert.rejects(
    boundedFetch(
      destination("digital", "AI"),
      "digital",
      async () =>
        new Response("x".repeat(MAX_BYTES + 1), {
          headers: { "Content-Type": "text/xml" },
        }),
    ),
    /サイズ/,
  );
});
test("timeouts abort stalled provider connections", async () => {
  let aborted = false;
  await assert.rejects(
    boundedFetch(
      destination("digital", "AI"),
      "digital",
      async (_url, { signal }) =>
        new Promise((_, reject) =>
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(Error("aborted"));
          }),
        ),
    ),
    /タイムアウト/,
  );
  assert.equal(aborted, true);
});
test("auth and invalid inputs prevent all DB and external requests", async () => {
  assert.equal((await onRequestGet({ request: req(), env: {} })).status, 503);
  assert.equal(
    (
      await onRequestGet({
        request: req("AI", "digital", "wrong"),
        env: env(null),
      })
    ).status,
    401,
  );
  for (const request of [
    req("AI", "unknown"),
    req("AI", "digital", "test", "&url=https://evil.example"),
    req("repo:private", "github"),
  ])
    assert.equal((await onRequestGet({ request, env: env(null) })).status, 400);
  assert.equal(
    (await onRequestGet({ request: req(), env: env(null) })).status,
    503,
  );
});
test("real SQLite cache filters RSS without refetch and keeps original timestamps", async () => {
  const db = d1(),
    original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return feed();
  };
  try {
    const first = await (
      await onRequestGet({ request: req(), env: env(db) })
    ).json();
    assert.equal(first.items.length, 1);
    const again = await (
      await onRequestGet({ request: req("無関係"), env: env(db) })
    ).json();
    assert.equal(again.cached, true);
    assert.equal(again.items.length, 0);
    assert.match(again.label, /該当0件/);
    assert.equal(again.fetchedAt, first.fetchedAt);
    assert.equal(calls, 1);
    db.db.exec(
      "CREATE TABLE business_jobs(id TEXT); INSERT INTO business_jobs VALUES('existing')",
    );
    assert.equal(
      db.db.prepare("SELECT COUNT(*) AS n FROM business_jobs").get().n,
      1,
    );
  } finally {
    globalThis.fetch = original;
    db.db.close();
  }
});
test("rate reservation is atomic and uses fail-closed D1 guards", async () => {
  const db = d1(),
    original = globalThis.fetch;
  globalThis.fetch = async () => feed();
  try {
    await onRequestGet({ request: req(), env: env(db) });
    db.db.exec("DELETE FROM research_cache");
    const result = await onRequestGet({ request: req(), env: env(db) });
    assert.equal(result.status, 429);
    assert.match((await result.json()).label, /未取得/);
    db.db.exec("DELETE FROM research_requests");
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 20; i++)
      db.db
        .prepare("INSERT INTO research_requests VALUES(?,?,?)")
        .run("r" + i, "other", now - 100);
    assert.equal(
      (await onRequestGet({ request: req(), env: env(db) })).status,
      429,
    );
  } finally {
    globalThis.fetch = original;
    db.db.close();
  }
});
test("upstream limits are cached with cooldown, failures never become acquired", async () => {
  const db = d1(),
    original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("", {
      status: 429,
      headers: { "Retry-After": "7200" },
    });
  };
  try {
    const first = await (
      await onRequestGet({ request: req("AI", "github"), env: env(db) })
    ).json();
    assert.equal(first.status, "unavailable");
    assert.equal(first.fetchedAt, null);
    const second = await onRequestGet({
      request: req("note", "github"),
      env: env(db),
    });
    assert.equal(second.status, 429);
    assert.equal(calls, 1);
    const cached = await (
      await onRequestGet({ request: req("AI", "github"), env: env(db) })
    ).json();
    assert.equal(cached.status, "unavailable");
    assert.equal(cached.cached, true);
  } finally {
    globalThis.fetch = original;
    db.db.close();
  }
});

test("simultaneous uncached requests cannot bypass the shared source interval", async () => {
  const db = d1(),
    original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return feed();
  };
  try {
    const results = await Promise.all([
      onRequestGet({ request: req("AI"), env: env(db) }),
      onRequestGet({ request: req("政策"), env: env(db) }),
    ]);
    assert.ok(results.some((r) => r.status === 429));
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
    db.db.close();
  }
});
test("expired caches cannot masquerade as current successful acquisition", async () => {
  const db = d1(),
    original = globalThis.fetch;
  globalThis.fetch = async () => feed();
  try {
    await onRequestGet({ request: req(), env: env(db) });
    db.db.exec(
      "UPDATE research_cache SET expires_at=0; DELETE FROM research_requests",
    );
    globalThis.fetch = async () => new Response("failed", { status: 500 });
    const result = await (
      await onRequestGet({ request: req(), env: env(db) })
    ).json();
    assert.equal(result.status, "unavailable");
    assert.equal(result.fetchedAt, null);
    assert.deepEqual(result.items, []);
  } finally {
    globalThis.fetch = original;
    db.db.close();
  }
});

test("unknown network failures are reported without leaking raw exception content", async () => {
  const db = d1(),
    original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error("internal secret=DO_NOT_SHOW");
  };
  try {
    const result = await (
      await onRequestGet({ request: req(), env: env(db) })
    ).json();
    assert.equal(result.status, "unavailable");
    assert.doesNotMatch(JSON.stringify(result), /DO_NOT_SHOW/);
  } finally {
    globalThis.fetch = original;
    db.db.close();
  }
});
