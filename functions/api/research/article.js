import {
  articleURL,
  extractArticle,
  robotsAllows,
  fetchPublic,
} from "../../../lib/article.js";
import {
  initNetwork,
  reserveNetwork,
  cacheRead,
  cacheWrite,
  denied,
  missing,
  responseJSON,
} from "../../../lib/research-network.js";
export async function onRequestGet({ request, env }) {
  const auth = denied(request, env);
  if (auth) return auth;
  const params = new URL(request.url).searchParams;
  let u;
  try {
    if (
      [...params.keys()].some((k) => k !== "url") ||
      params.getAll("url").length !== 1
    )
      return missing("本文URLはurlパラメーター1個で指定してください", 400);
    u = articleURL(params.get("url"));
  } catch (error) {
    return missing(
      error.message?.startsWith("本文URL：")
        ? error.message
        : "本文URLの形式を確認してください",
      400,
    );
  }
  const source = u.hostname === "www.digital.go.jp" ? "digital" : "caa",
    db = env.JARVIS_DB;
  try {
    await initNetwork(db);
    const key = "article:" + u.href;
    const cached = await cacheRead(db, key);
    if (cached) return responseJSON({ ...cached, cached: true });
    const feed = await cacheRead(db, source);
    if (
      feed?.status !== "acquired" ||
      !feed.items?.some((r) => r.sourceUrl === u.href)
    )
      return missing(
        "取得済みの最新RSSにこのURLが見つかりません。RSSを再取得して掲載されたページを選んでください",
        400,
      );
    if (await cacheRead(db, "page-pause:" + source))
      return missing("提供元の待機期間中のため未取得です", 429);
    let result;
    try {
      const robotsKey = "robots:" + u.origin;
      let robots = await cacheRead(db, robotsKey);
      if (!robots) {
        await reserveNetwork(db, "robots:" + source, 2);
        robots = await fetchPublic(u.origin + "/robots.txt", { robots: true });
        await cacheWrite(db, robotsKey, robots, 21600);
      }
      if (!robotsAllows(robots.text, u.pathname))
        throw Error("robots.txtで取得が許可されていないため未取得です");
      await reserveNetwork(db, "page:" + source, 4);
      const html = await fetchPublic(u.href);
      const article = extractArticle(html.text);
      result = {
        status: "acquired",
        label: "本文取得済み（内容は未検証）",
        ...article,
        sourceUrl: u.href,
        fetchedAt: new Date().toISOString(),
        rssFetchedAt: feed.items.find((r) => r.sourceUrl === u.href).fetchedAt,
        scope:
          "許可された本文領域のみ・最大12000文字。全文転載や真偽の保証は行いません。",
      };
    } catch (error) {
      if (error.pause)
        await cacheWrite(db, "page-pause:" + source, {}, error.pause);
      result = {
        status: "unavailable",
        label: "未取得",
        fetchedAt: null,
        error: /^(提供元|取得|公開|本文|対応|robots|リダイレクト|8秒)/.test(
          error.message || "",
        )
          ? error.message
          : "公開ページに接続または解析できませんでした",
      };
    }
    await cacheWrite(
      db,
      key,
      result,
      result.status === "acquired" ? 21600 : 300,
    );
    return responseJSON({ ...result, cached: false });
  } catch {
    return missing("D1・取得制限の処理に失敗しました。本文は未取得です");
  }
}
