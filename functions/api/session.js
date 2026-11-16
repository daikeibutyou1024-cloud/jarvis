import {previewHost,validSession,sessionCookie,clearSessionCookie,sessionExpiry} from '../../lib/preview-session.js';
const json=(body,status=200,cookie)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store',...(cookie?{'set-cookie':cookie}:{})}});
export async function onRequest({request,env}){
 if(!previewHost(request,env))return json({error:'対象Previewのみ利用できます'},403);
 if(request.method==='GET'){const authenticated=await validSession(request,env);return json({authenticated,expiresAt:authenticated?sessionExpiry(request):null,expiresInSeconds:authenticated?Math.max(0,Math.floor((sessionExpiry(request)-Date.now())/1000)):0});}
 if(request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'同一オリジンから操作してください'},403);
 if(request.method==='DELETE')return json({authenticated:false},200,clearSessionCookie());
 if(request.method!=='POST')return json({error:'操作が不正です'},405);
 if(!env.JARVIS_ACCESS_PASSWORD||request.headers.get('x-jarvis-password')!==env.JARVIS_ACCESS_PASSWORD)return json({error:'認証できませんでした'},401);
 return json({authenticated:true,expiresAt:Math.floor(Date.now()/1000)*1000+8*3600000,expiresInSeconds:8*3600},200,await sessionCookie(request,env));
}
