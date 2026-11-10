import { SCHEMA } from "../functions/api/research/collect.js";
export async function initNetwork(db) {
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
}
export async function reserveNetwork(
  db,
  source,
  max = 4,
  now = Math.floor(Date.now() / 1000),
) {
  await db
    .prepare("DELETE FROM research_requests WHERE attempted_at<?")
    .bind(now - 86400)
    .run();
  const result = await db
    .prepare(
      "INSERT INTO research_requests(id,source,attempted_at) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM research_requests WHERE attempted_at>?)<20 AND (SELECT COUNT(*) FROM research_requests WHERE source=? AND attempted_at>?)<? AND NOT EXISTS (SELECT 1 FROM research_requests WHERE source=? AND attempted_at>?)",
    )
    .bind(
      crypto.randomUUID(),
      source,
      now,
      now - 3600,
      source,
      now - 3600,
      max,
      source,
      now - 60,
    )
    .run();
  if (!result.meta?.changes)
    throw Error("取得回数制限です。時間をおいて再試行してください");
}
export async function cacheRead(db, key, now = Math.floor(Date.now() / 1000)) {
  const r = await db
    .prepare("SELECT payload FROM research_cache WHERE key=? AND expires_at>?")
    .bind(key, now)
    .first();
  return r ? JSON.parse(r.payload) : null;
}
export async function cacheWrite(db, key, data, seconds) {
  await db
    .prepare(
      "INSERT OR REPLACE INTO research_cache(key,payload,expires_at) VALUES(?,?,?)",
    )
    .bind(key, JSON.stringify(data), Math.floor(Date.now() / 1000) + seconds)
    .run();
}
export const responseJSON = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
export const missing = (error, status = 503) =>
  responseJSON(
    { status: "unavailable", label: "未取得", error, fetchedAt: null },
    status,
  );
export function denied(request, env) {
  if (!env.JARVIS_ACCESS_PASSWORD) return missing("アクセス設定が未設定です");
  if (request.headers.get("x-jarvis-password") !== env.JARVIS_ACCESS_PASSWORD)
    return missing("アクセス用パスワードが違います", 401);
  if (!env.JARVIS_DB) return missing("D1未接続です");
  return null;
}
