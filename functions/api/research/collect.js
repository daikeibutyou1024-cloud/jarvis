import { XMLParser, XMLValidator } from "../../../vendor/xml/parser.js";
import { sourceCatalog, referenceUrl } from "../../../assets/research-data.js";
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
const unavailable = (reason, status = 503) =>
  json(
    {
      status: "unavailable",
      label: "未取得",
      error: reason,
      items: [],
      fetchedAt: null,
    },
    status,
  );
export const MAX_BYTES = 1024 * 1024;
export const TIMEOUT_MS = 8000;
const list = (x) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
const plain = (value) =>
  String(typeof value === "object" ? value?.["#text"] || "" : value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
export function destination(source, query) {
  if (!Object.hasOwn(sourceCatalog, source))
    throw Error("接続先は許可されていません");
  if (source !== "github") return sourceCatalog[source].url;
  const url = new URL(sourceCatalog.github.url);
  // Only words, not GitHub qualifiers/operators, are accepted from this UI.
  url.search = new URLSearchParams({
    q: query + " in:name,description is:public",
    per_page: "10",
    sort: "updated",
    order: "desc",
  });
  return url.href;
}
export async function boundedFetch(url, source, fetcher = fetch) {
  const u = new URL(url);
  const expected = new URL(
    sourceCatalog[source]?.url || "https://invalid.invalid",
  );
  if (
    u.origin !== expected.origin ||
    u.pathname !== expected.pathname ||
    u.username ||
    u.password ||
    (source !== "github" && u.search)
  )
    throw Error("接続先は許可されていません");
  const controller = new AbortController();
  let timer;
  const task = async () => {
    const response = await fetcher(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: {
        Accept:
          source === "github"
            ? "application/vnd.github+json"
            : "application/rss+xml, application/rdf+xml, application/atom+xml, application/xml, text/xml",
        "User-Agent":
          "JARVIS-Research/2.0 (+https://github.com/daikeibutyou1024-cloud/jarvis)",
        ...(source === "github"
          ? { "X-GitHub-Api-Version": "2022-11-28" }
          : {}),
      },
    });
    if (response.status >= 300 && response.status < 400)
      throw Error("リダイレクト先の取得は禁止しています");
    if (response.status === 429 || response.status === 403) {
      const err = Error("提供元のアクセス制限・利用条件により未取得です");
      err.cooldown = Math.max(
        600,
        Number(response.headers.get("Retry-After")) ||
          Math.ceil(
            (Date.parse(response.headers.get("Retry-After")) - Date.now()) /
              1000,
          ) ||
          Number(response.headers.get("x-ratelimit-reset")) -
            Math.floor(Date.now() / 1000) ||
          3600,
      );
      throw err;
    }
    if (!response.ok) throw Error(`提供元HTTP ${response.status}：未取得`);
    const contentType = response.headers.get("Content-Type") || "";
    if (
      !(
        source === "github"
          ? /application\/(?:[\w.+-]*\+)?json/i
          : /\b(?:application|text)\/(?:rss\+xml|rdf\+xml|atom\+xml|xml)/i
      ).test(contentType)
    )
      throw Error("提供元のデータ形式が想定と異なります");
    if (Number(response.headers.get("Content-Length")) > MAX_BYTES)
      throw Error("取得サイズ上限（1MB）を超えています");
    if (!response.body) throw Error("提供元の応答が空です");
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let text = "",
      bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) {
          await reader.cancel();
          throw Error("取得サイズ上限（1MB）を超えています");
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    return text;
  };
  try {
    return await Promise.race([
      task(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(Error("8秒でタイムアウトしました"));
        }, TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
export function parseRecords(text, source, now = new Date().toISOString()) {
  let rows;
  if (source === "github") {
    const data = JSON.parse(text);
    if (!Array.isArray(data.items) || data.incomplete_results === true)
      throw Error("GitHubの検索結果が不完全です");
    rows = data.items
      .slice(0, 10)
      .filter((r) => !r.private)
      .map((r) => ({
        title: plain(r.full_name).slice(0, 160),
        url: r.html_url,
        text: `公開リポジトリ：${plain(r.description).slice(0, 200)} / Stars ${Number.isSafeInteger(r.stargazers_count) ? r.stargazers_count : "未取得"} / 更新 ${plain(r.updated_at) || "未取得"}。人気・収益・安全性の保証ではありません。`,
        publishedAt: r.updated_at,
      }));
  } else {
    if (
      /<!DOCTYPE|<!ENTITY/i.test(text) ||
      XMLValidator.validate(text) !== true
    )
      throw Error("RSS XMLの形式が不正です");
    const data = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      removeNSPrefix: true,
      parseTagValue: false,
      processEntities: true,
    }).parse(text);
    const items = data.RDF?.item ?? data.rss?.channel?.item ?? data.feed?.entry;
    if (!data.RDF && !data.rss?.channel && !data.feed)
      throw Error("RSS/Atom形式ではありません");
    rows = list(items)
      .slice(0, 60)
      .map((r) => ({
        title: plain(r.title).slice(0, 160),
        url:
          typeof r.link === "string"
            ? r.link
            : list(r.link).find(
                (l) => !l["@_rel"] || l["@_rel"] === "alternate",
              )?.["@_href"],
        text:
          plain(r.description || r.summary || "").slice(0, 350) ||
          "RSS見出しのみ取得。記事本文・商品仕様は未取得。",
        publishedAt:
          plain(r.date || r.pubDate || r.published || r.updated) || null,
      }));
  }
  return rows
    .filter((r) => {
      try {
        const u = new URL(referenceUrl(r.url));
        return u.hostname === sourceCatalog[source].host && !!r.title;
      } catch {
        return false;
      }
    })
    .map((r, i) => ({
      id: `${source}:${i}:${now}`,
      title: r.title,
      text: r.text,
      sourceUrl: referenceUrl(r.url),
      fetchedAt: now,
      recordedAt: now,
      publishedAt: r.publishedAt || null,
      origin: source,
      kind: "fact",
      verification: "source_observed",
      status: "acquired",
      price: "",
      affiliate: "",
    }));
}
export const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS research_cache (key TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS research_requests (id TEXT PRIMARY KEY, source TEXT NOT NULL, attempted_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_research_requests_time ON research_requests(attempted_at)",
];
export async function onRequestGet({ request, env }) {
  if (!env.JARVIS_ACCESS_PASSWORD)
    return unavailable("アクセス用パスワードが未設定です");
  if (request.headers.get("x-jarvis-password") !== env.JARVIS_ACCESS_PASSWORD)
    return unavailable("アクセス用パスワードが違います", 401);
  const url = new URL(request.url),
    source = url.searchParams.get("source"),
    query = (url.searchParams.get("q") || "").trim();
  if (
    [...url.searchParams.keys()].some((k) => !["source", "q"].includes(k)) ||
    !Object.hasOwn(sourceCatalog, source) ||
    query.length < 1 ||
    query.length > 80 ||
    /[\u0000-\u001f:<>"\\]/.test(query)
  )
    return unavailable(
      "許可された情報源と1〜80文字のキーワードを指定してください",
      400,
    );
  if (!env.JARVIS_DB)
    return unavailable("D1未接続のため、安全な回数制限を利用できません");
  const now = Math.floor(Date.now() / 1000),
    key = source === "github" ? `github:${query.toLowerCase()}` : source;
  try {
    await env.JARVIS_DB.batch(SCHEMA.map((sql) => env.JARVIS_DB.prepare(sql)));
    const cached = await env.JARVIS_DB.prepare(
      "SELECT payload FROM research_cache WHERE key=? AND expires_at>?",
    )
      .bind(key, now)
      .first();
    let data;
    if (cached) {
      data = JSON.parse(cached.payload);
      data.cached = true;
    } else {
      const paused = await env.JARVIS_DB.prepare(
        "SELECT payload FROM research_cache WHERE key=? AND expires_at>?",
      )
        .bind("pause:" + source, now)
        .first();
      if (paused)
        return unavailable(
          "提供元の再試行待機中です。時間をおいて再取得してください",
          429,
        );
      await env.JARVIS_DB.batch([
        env.JARVIS_DB.prepare(
          "DELETE FROM research_cache WHERE expires_at<=?",
        ).bind(now),
        env.JARVIS_DB.prepare(
          "DELETE FROM research_requests WHERE attempted_at<?",
        ).bind(now - 86400),
      ]);
      // One conditional write is the reservation: concurrent requests cannot both consume the last slot.
      const reservation = await env.JARVIS_DB.prepare(
        "INSERT INTO research_requests(id,source,attempted_at) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM research_requests WHERE attempted_at>?)<20 AND (SELECT COUNT(*) FROM research_requests WHERE source=? AND attempted_at>?)<? AND NOT EXISTS (SELECT 1 FROM research_requests WHERE source=? AND attempted_at>?)",
      )
        .bind(
          crypto.randomUUID(),
          source,
          now,
          now - 3600,
          source,
          now - 3600,
          source === "github" ? 8 : 6,
          source,
          now - 60,
        )
        .run();
      if (!reservation.meta?.changes)
        return unavailable(
          "取得回数制限です（全体20回/時・GitHub8回/時・各RSS6回/時・同じ情報源は1分間隔）。キャッシュ済みの検索は利用できます",
          429,
        );
      try {
        const items = parseRecords(
          await boundedFetch(destination(source, query), source),
          source,
        );
        data = {
          status: "acquired",
          items,
          fetchedAt: new Date().toISOString(),
          cached: false,
        };
      } catch (error) {
        data = {
          status: "unavailable",
          items: [],
          fetchedAt: null,
          error:
            /^(接続先|リダイレクト|提供元|取得サイズ|8秒|RSS XML|RSS\/Atom|GitHubの検索)/.test(
              error.message || "",
            )
              ? error.message
              : "外部接続またはデータ解析に失敗しました。情報は未取得です",
        };
        if (error.cooldown)
          await env.JARVIS_DB.prepare(
            "INSERT OR REPLACE INTO research_cache(key,payload,expires_at) VALUES(?,?,?)",
          )
            .bind("pause:" + source, "{}", now + error.cooldown)
            .run();
      }
      await env.JARVIS_DB.prepare(
        "INSERT OR REPLACE INTO research_cache(key,payload,expires_at) VALUES(?,?,?)",
      )
        .bind(
          key,
          JSON.stringify(data),
          now +
            (data.status === "unavailable"
              ? 300
              : source === "github"
                ? 21600
                : 3600),
        )
        .run();
    }
    const items =
      source === "github"
        ? data.items
        : data.items
            .filter((item) =>
              (item.title + " " + item.text)
                .toLocaleLowerCase()
                .includes(query.toLocaleLowerCase()),
            )
            .slice(0, 10);
    return json({
      ...data,
      items,
      source,
      query,
      sourceName: sourceCatalog[source].name,
      policyUrl: sourceCatalog[source].policy,
      label:
        data.status === "unavailable"
          ? "未取得"
          : items.length
            ? "取得済み"
            : "取得済み（配信範囲で該当0件）",
      scope:
        source === "github"
          ? "公開リポジトリ検索・最大10件。売上やサービスの有料プランは未取得。"
          : "RSSの直近最大60件を部分一致で絞り込み・表示最大10件。Web全体や記事本文は未取得。",
    });
  } catch {
    return unavailable(
      "D1の初期化・キャッシュ・回数制限の処理に失敗しました。外部取得は完了確認できません",
    );
  }
}
