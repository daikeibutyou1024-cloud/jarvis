const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

export function authorized(request, env) {
  return Boolean(env.JARVIS_ACCESS_PASSWORD) &&
    request.headers.get("x-jarvis-password") === env.JARVIS_ACCESS_PASSWORD;
}

export function configError(env) {
  const missing = [];
  if (!env.GOOGLE_CLIENT_ID) missing.push("GOOGLE_CLIENT_ID");
  if (!env.GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");
  if (!env.GOOGLE_REDIRECT_URI) missing.push("GOOGLE_REDIRECT_URI");
  if (!env.JARVIS_TOKEN_ENCRYPTION_KEY) missing.push("JARVIS_TOKEN_ENCRYPTION_KEY");
  if (!env.JARVIS_DB) missing.push("D1 binding JARVIS_DB");
  return missing.length
    ? "Cloudflareで未読込の設定があります：" + missing.join("、") + "。設定の保存後にPagesを再デプロイしてください。"
    : "";
}

function encryptionKey(env) {
  const raw = atob(env.JARVIS_TOKEN_ENCRYPTION_KEY);
  if (raw.length !== 32) throw new Error("暗号化キーは32バイトである必要があります。");
  return crypto.subtle.importKey(
    "raw",
    Uint8Array.from(raw, c => c.charCodeAt(0)),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptToken(token, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(env);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(token)
  );
  const bytes = new Uint8Array(iv.length + encrypted.byteLength);
  bytes.set(iv);
  bytes.set(new Uint8Array(encrypted), iv.length);
  let binary = "";
  bytes.forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary);
}

export async function decryptToken(value, env) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  const iv = bytes.slice(0, 12);
  const encrypted = bytes.slice(12);
  const key = await encryptionKey(env);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
  return new TextDecoder().decode(plain);
}

export async function getAccessToken(env) {
  const row = await env.JARVIS_DB.prepare(
    "SELECT encrypted_refresh_token FROM google_tokens WHERE id = 1"
  ).first();
  if (!row?.encrypted_refresh_token) throw new Error("Googleカレンダーが未接続です。先にGoogle接続を行ってください。");

  const refreshToken = await decryptToken(row.encrypted_refresh_token, env);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Googleアクセストークンを更新できませんでした。");
  }
  return data.access_token;
}

export async function googleRequest(env, path, options = {}) {
  const token = await getAccessToken(env);
  const response = await fetch("https://www.googleapis.com/calendar/v3" + path, {
    ...options,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "Google Calendar APIでエラーが発生しました。");
  }
  return data;
}

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
