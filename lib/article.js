import { parse } from "../vendor/html/parser.js";
const hosts = new Set(["www.digital.go.jp", "www.caa.go.jp"]);
export function articleURL(raw) {
  if (typeof raw !== "string" || raw.length > 400 || /[\\%?#]/.test(raw))
    throw Error("許可されていない本文URLです");
  const u = new URL(raw);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    !hosts.has(u.hostname) ||
    !/^\/(?:news\/|notice\/entry\/)[a-zA-Z0-9_./-]+$/.test(u.pathname) ||
    /\.\.|\.(?:pdf|xml|json|zip|exe)$/i.test(u.pathname)
  )
    throw Error("許可されていない本文URLです");
  return u;
}
const ignored = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "svg",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "button",
  "input",
  "select",
  "textarea",
]);
export function extractArticle(html) {
  const doc = parse(html);
  const matches = [];
  function find(node) {
    const attrs = Object.fromEntries(
      (node.attrs || []).map((a) => [a.name, a.value]),
    );
    if (
      node.tagName === "article" ||
      node.tagName === "main" ||
      attrs.role === "main" ||
      ["main", "main-contents", "main_content"].includes(attrs.id)
    )
      matches.push(node);
    if (!ignored.has(node.tagName))
      for (const child of node.childNodes || []) find(child);
  }
  find(doc);
  const chosen = matches.find((n) => n.tagName === "article") || matches[0];
  if (!chosen) throw Error("本文領域が見つからないため未取得です");
  let text = "";
  function walk(node) {
    const attrs = Object.fromEntries(
      (node.attrs || []).map((a) => [a.name, a.value]),
    );
    if (
      ignored.has(node.tagName) ||
      Object.hasOwn(attrs, "hidden") ||
      attrs["aria-hidden"] === "true"
    )
      return;
    if (node.nodeName === "#text") text += node.value + " ";
    for (const child of node.childNodes || []) walk(child);
    if (
      ["p", "div", "section", "h1", "h2", "h3", "li", "br"].includes(
        node.tagName,
      )
    )
      text += "\n";
  }
  walk(chosen);
  text = text
    .split("\n")
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  if (text.length < 80)
    throw Error("本文が短すぎる・動的ページのため未取得です");
  return { text: text.slice(0, 12000), truncated: text.length > 12000 };
}
export function robotsAllows(text, path) {
  const groups = [];
  let group = null,
    hasRule = false;
  for (const line of text.split(/\r?\n/)) {
    const clean = line.split("#")[0].trim(),
      i = clean.indexOf(":");
    if (i < 0) continue;
    const key = clean.slice(0, i).toLowerCase(),
      value = clean.slice(i + 1).trim();
    if (key === "user-agent") {
      if (!group || hasRule) {
        group = { agents: [], rules: [] };
        groups.push(group);
        hasRule = false;
      }
      group.agents.push(value.toLowerCase());
    } else if (group && ["allow", "disallow"].includes(key)) {
      hasRule = true;
      if (value) group.rules.push({ allow: key === "allow", path: value });
    }
  }
  const specific = groups.filter((g) =>
    g.agents.some((a) => a !== "*" && "jarvis-research".includes(a)),
  );
  const selected = specific.length
    ? specific
    : groups.filter((g) => g.agents.includes("*"));
  let best = null;
  for (const rule of selected.flatMap((g) => g.rules)) {
    let pattern = rule.path,
      anchor = pattern.endsWith("$");
    if (anchor) pattern = pattern.slice(0, -1);
    const re =
      "^" +
      pattern
        .split("*")
        .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*") +
      (anchor ? "$" : "");
    if (
      new RegExp(re).test(path) &&
      (!best ||
        pattern.length > best.path.length ||
        (pattern.length === best.path.length && rule.allow))
    )
      best = rule;
  }
  return !best || best.allow;
}
export async function fetchPublic(
  url,
  { robots = false, fetcher = fetch } = {},
) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const r = await fetcher(url, {
          redirect: "manual",
          signal: controller.signal,
          headers: {
            Accept: robots ? "text/plain" : "text/html",
            "User-Agent":
              "JARVIS-Research/3.0 (+https://github.com/daikeibutyou1024-cloud/jarvis)",
          },
        });
        if (robots && r.status === 404) return { text: "", absent: true };
        if (r.status === 403 || r.status === 429) {
          const e = Error("提供元の制限により未取得です");
          const retry = r.headers.get("Retry-After");
          e.pause = Math.max(
            3600,
            Number(retry) ||
              Math.ceil((Date.parse(retry) - Date.now()) / 1000) ||
              0,
          );
          throw e;
        }
        if (r.status >= 300 && r.status < 400)
          throw Error("リダイレクトは禁止しています");
        if (!r.ok) throw Error("提供元の応答エラーにより未取得です");
        if (
          !(
            robots
              ? /^text\/plain\b/i
              : /^(?:text\/html|application\/xhtml\+xml)\b/i
          ).test(r.headers.get("Content-Type") || "")
        )
          throw Error("公開ページの形式が異なるため未取得です");
        if (
          (r.headers.get("Content-Type") || "").match(
            /charset\s*=\s*["']?([^\s;"']+)/i,
          )?.[1] &&
          !["utf-8", "utf8", "us-ascii"].includes(
            (r.headers.get("Content-Type") || "")
              .match(/charset\s*=\s*["']?([^\s;"']+)/i)[1]
              .toLowerCase(),
          )
        )
          throw Error("対応していない文字コードのため未取得です");
        const max = robots ? 256000 : 1000000;
        if (Number(r.headers.get("Content-Length")) > max || !r.body)
          throw Error("取得量制限または空の本文です");
        const reader = r.body.getReader(),
          decoder = new TextDecoder("utf-8", { fatal: true });
        let size = 0,
          text = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > max) {
              await reader.cancel();
              throw Error("取得量制限を超えています");
            }
            text += decoder.decode(value, { stream: true });
          }
          text += decoder.decode();
        } finally {
          reader.releaseLock();
        }
        return { text };
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(Error("8秒で本文取得がタイムアウトしました"));
        }, 8000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
