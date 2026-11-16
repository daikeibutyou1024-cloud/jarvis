import {validSession} from '../../lib/preview-session.js';
export async function onRequest(context){
 const {request,env}=context,u=new URL(request.url);
 if(!u.pathname.startsWith('/api/')||u.pathname==='/api/session'||!await validSession(request,env))return context.next();
 const origin=request.headers.get('Origin'),site=request.headers.get('Sec-Fetch-Site');
 if((origin&&origin!==u.origin)||(site&&!['same-origin','none'].includes(site))||(!['GET','HEAD'].includes(request.method)&&origin!==u.origin))return new Response(JSON.stringify({error:'同一オリジンから操作してください'}),{status:403,headers:{'content-type':'application/json','cache-control':'no-store'}});
 const headers=new Headers(request.headers);headers.set('x-jarvis-password',env.JARVIS_ACCESS_PASSWORD);
 return context.next(new Request(request,{headers}));
}
