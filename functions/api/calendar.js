import { authorized, configError, googleRequest, json } from "./google/_shared.js";

function eventBody(body) {
  const summary = String(body.summary || "").trim();
  const start = String(body.start || "").trim();
  const end = String(body.end || "").trim();
  if (!summary || !start || !end) throw new Error("予定名・開始日時・終了日時を入力してください。");
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
    throw new Error("日時の形式または開始・終了の順序を確認してください。");
  }
  return {
    summary,
    description: String(body.description || "").slice(0, 4000),
    start: { dateTime: startDate.toISOString(), timeZone: "Asia/Tokyo" },
    end: { dateTime: endDate.toISOString(), timeZone: "Asia/Tokyo" }
  };
}

export async function onRequestGet({ request, env }) {
  if (!authorized(request, env)) return json({ error: "アクセス用パスワードが違います。" }, 401);
  const missing = configError(env);
  if (missing) return json({ error: missing }, 500);
  try {
    const url = new URL(request.url);
    const timeMin = url.searchParams.get("timeMin") || new Date().toISOString();
    const timeMax = url.searchParams.get("timeMax") || new Date(Date.now() + 30 * 86400000).toISOString();
    const query = new URLSearchParams({
      timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "100"
    });
    const data = await googleRequest(env, "/calendars/primary/events?" + query.toString());
    return json({ connected: true, events: data.items || [] });
  } catch (error) {
    return json({ error: error.message || "予定を取得できませんでした。" }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!authorized(request, env)) return json({ error: "アクセス用パスワードが違います。" }, 401);
  const missing = configError(env);
  if (missing) return json({ error: missing }, 500);
  try {
    const body = await request.json();
    const event = eventBody(body);
    const created = await googleRequest(env, "/calendars/primary/events", {
      method: "POST", body: JSON.stringify(event)
    });
    return json({ success: true, event: created }, 201);
  } catch (error) {
    return json({ error: error.message || "予定を登録できませんでした。" }, 400);
  }
}

export async function onRequestPut({ request, env }) {
  if (!authorized(request, env)) return json({ error: "アクセス用パスワードが違います。" }, 401);
  const missing = configError(env);
  if (missing) return json({ error: missing }, 500);
  try {
    const body = await request.json();
    const eventId = String(body.eventId || "").trim();
    if (!eventId) return json({ error: "変更する予定のIDがありません。" }, 400);
    const event = eventBody(body);
    const updated = await googleRequest(env, "/calendars/primary/events/" + encodeURIComponent(eventId), {
      method: "PUT", body: JSON.stringify(event)
    });
    return json({ success: true, event: updated });
  } catch (error) {
    return json({ error: error.message || "予定を変更できませんでした。" }, 400);
  }
}

export async function onRequestDelete({ request, env }) {
  if (!authorized(request, env)) return json({ error: "アクセス用パスワードが違います。" }, 401);
  const missing = configError(env);
  if (missing) return json({ error: missing }, 500);
  try {
    const url = new URL(request.url);
    const eventId = url.searchParams.get("eventId");
    if (!eventId) return json({ error: "削除する予定のIDがありません。" }, 400);
    await googleRequest(env, "/calendars/primary/events/" + encodeURIComponent(eventId), { method: "DELETE" });
    return json({ success: true });
  } catch (error) {
    return json({ error: error.message || "予定を削除できませんでした。" }, 400);
  }
}
