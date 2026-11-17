import { configError, encryptToken } from "./_shared.js";

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function page(message, success = false) {
  const color = success ? "#58ffc2" : "#ff9b9b";
  const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>J.A.R.V.I.S. Google連携</title><body style="margin:0;background:#030814;color:#e6f8ff;font-family:Arial,sans-serif;display:grid;place-items:center;min-height:100vh"><main style="max-width:560px;padding:28px;border:1px solid #24516d;border-radius:14px;background:#071629"><h2 style="color:${color}">J.A.R.V.I.S. Google連携</h2><p>${escapeHtml(message)}</p><p>この画面を閉じて、JARVISの司令室に戻ってください。</p></main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function onRequestGet({ request, env }) {
  const missing = configError(env);
  if (missing) return page(missing);

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  if (oauthError) return page("Google認証がキャンセルされたか、拒否されました。");
  if (!code || !state) return page("認証情報が不足しています。最初から接続をやり直してください。");

  try {
    const now = Math.floor(Date.now() / 1000);
    const stored = await env.JARVIS_DB.prepare(
      "SELECT state FROM google_oauth_states WHERE state = ? AND expires_at > ?"
    ).bind(state, now).first();
    await env.JARVIS_DB.prepare("DELETE FROM google_oauth_states WHERE state = ?").bind(state).run();
    if (!stored) return page("認証の有効期限が切れたか、確認に失敗しました。JARVISから再接続してください。");

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: env.GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code"
      })
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok) {
      return page(tokens.error_description || tokens.error || "Googleのトークン取得に失敗しました。");
    }
    if (!tokens.refresh_token) {
      return page("Googleから更新用トークンが返されませんでした。JARVISから再接続し、Googleの許可画面で承認してください。");
    }

    const encrypted = await encryptToken(tokens.refresh_token, env);
    await env.JARVIS_DB.prepare(
      "INSERT INTO google_tokens (id, encrypted_refresh_token, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET encrypted_refresh_token = excluded.encrypted_refresh_token, updated_at = CURRENT_TIMESTAMP"
    ).bind(encrypted).run();
    return page("Googleカレンダーとの接続が完了しました。", true);
  } catch (error) {
    return page(error.message || "Google連携中にエラーが発生しました。");
  }
}
