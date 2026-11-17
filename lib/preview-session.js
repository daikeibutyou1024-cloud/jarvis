import {workspaceHost} from './workspace-target.js';
const COOKIE='__Host-jarvis_session',TTL=8*3600;
const enc=new TextEncoder();
const b64=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const unb64=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
export function previewHost(request,env){const u=new URL(request.url);return env.CF_PAGES_BRANCH==='feature/ai-business-rebuild'&&u.protocol==='https:'&&!u.port&&/^(?:[a-f0-9]{8}|feature-ai-business-rebuild)\.asset-simulator-87y\.pages\.dev$/.test(u.hostname);}
async function key(env){if(!env.JARVIS_ACCESS_PASSWORD)throw Error();return crypto.subtle.importKey('raw',enc.encode('jarvis-session-v1:'+env.JARVIS_ACCESS_PASSWORD),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function sessionCookie(request,env,now=Date.now()){
 const payload=b64(enc.encode(JSON.stringify({aud:new URL(request.url).hostname,iat:Math.floor(now/1000),exp:Math.floor(now/1000)+TTL,nonce:crypto.randomUUID()})));
 const signature=b64(new Uint8Array(await crypto.subtle.sign('HMAC',await key(env),enc.encode(payload))));
 return `${COOKIE}=${payload}.${signature}; Path=/; Max-Age=${TTL}; HttpOnly; Secure; SameSite=Strict`;
}
export async function validSession(request,env,now=Date.now()){
 try{if(!workspaceHost(request,env))return false;const token=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);if(!token||token.length>2000)return false;const [payload,sig,extra]=token.split('.');if(extra||!sig||!await crypto.subtle.verify('HMAC',await key(env),unb64(sig),enc.encode(payload)))return false;const p=JSON.parse(new TextDecoder().decode(unb64(payload))),n=Math.floor(now/1000);return p.aud===new URL(request.url).hostname&&Number.isSafeInteger(p.iat)&&Number.isSafeInteger(p.exp)&&p.iat<=n&&p.exp>n&&p.exp-p.iat===TTL;}catch{return false;}
}
export const clearSessionCookie=()=>`${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

export function sessionExpiry(request){try{const t=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);return JSON.parse(new TextDecoder().decode(unb64(t.split('.')[0]))).exp*1000;}catch{return 0;}}
