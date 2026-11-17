import { authorized, configError, json, CALENDAR_SCOPE } from "./_shared.js";

export async function onRequestGet({ request, env }) {
  if (!authorized(request, env)) return json({ error: "アクセス用パスワードが違います。" }, 401);
  const missing = configError(env);
  if (missing) return json({ error: missing }, 500);

  try {
    const state = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await env.JARVIS_DB.prepare(
      "INSERT INTO google_oauth_states (state, created_at, expires_at) VALUES (?, ?, ?)"
    ).bind(state, now, now + 600).run();

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      response_type: "code",
      scope: CALENDAR_SCOPE,
      access_type: "offline",
      prompt: "consent",
      state
    }).toString();
    return json({ url: url.toString() });
  } catch (error) {
    return json({ error: error.message || "Google接続を開始できませんでした。" }, 500);
  }
}
