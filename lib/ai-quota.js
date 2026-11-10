// Shared durable cap, reserved before any billable request. Failure consumes a slot.
export async function reserveAI(
  env,
  purpose,
  now = Math.floor(Date.now() / 1000),
) {
  if (!env.JARVIS_DB) throw Error("利用回数を管理するD1が未接続です");
  const db = env.JARVIS_DB;
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS ai_usage (id TEXT PRIMARY KEY, purpose TEXT NOT NULL, created_at INTEGER NOT NULL)",
    )
    .run();
  await db
    .prepare(
      "CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at)",
    )
    .run();
  await db
    .prepare("DELETE FROM ai_usage WHERE created_at<?")
    .bind(now - 172800)
    .run();
  const day = Math.floor(now / 86400) * 86400;
  const result = await db
    .prepare(
      "INSERT INTO ai_usage(id,purpose,created_at) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM ai_usage WHERE created_at>=?)<10 AND (SELECT COUNT(*) FROM ai_usage WHERE purpose=? AND created_at>=?)<?",
    )
    .bind(
      crypto.randomUUID(),
      purpose,
      now,
      day,
      purpose,
      day,
      purpose === "ideas" ? 2 : purpose === "job" ? 5 : 10,
    )
    .run();
  return !!result.meta?.changes;
}
