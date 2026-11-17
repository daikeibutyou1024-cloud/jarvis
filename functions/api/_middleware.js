import {workspaceTarget} from '../../lib/workspace-target.js';
import {validSession} from '../../lib/preview-session.js';
export async function onRequest(context){
 const {request,env}=context,u=new URL(request.url);
 if(env.CF_PAGES_BRANCH==='main'&&/^\/api\/business\/(?:schedules|tick|automation)(?:$|\/)/.test(u.pathname))return Response.json({error:'定期収集・モック自動化は本番では停止中です'},{status:503,headers:{'cache-control':'no-store'}});
 if(env.CF_PAGES_BRANCH==='main'&&u.pathname.startsWith('/api/')&&!workspaceTarget(request,env))return Response.json({error:'本番の承認済み設定を確認できません'},{status:503,headers:{'cache-control':'no-store'}});
 const legacy=/^\/api\/(?:calendar|assets|pet-analyze|google(?:\/|$))/.test(u.pathname);
 if(legacy)return Response.json({error:'カレンダー・動画関連の連携は初期版では停止中です'},{status:503,headers:{'cache-control':'no-store'}});
 if(!u.pathname.startsWith('/api/')||u.pathname==='/api/session'||!await validSession(request,env))return context.next();
 const origin=request.headers.get('Origin'),site=request.headers.get('Sec-Fetch-Site');
 if((origin&&origin!==u.origin)||(site&&!['same-origin','none'].includes(site))||(!['GET','HEAD'].includes(request.method)&&origin!==u.origin))return new Response(JSON.stringify({error:'同一オリジンから操作してください'}),{status:403,headers:{'content-type':'application/json','cache-control':'no-store'}});
 const headers=new Headers(request.headers);headers.set('x-jarvis-password',env.JARVIS_ACCESS_PASSWORD);
 return context.next(new Request(request,{headers}));
}
