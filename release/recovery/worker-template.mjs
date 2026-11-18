// Independent Pages advanced-mode recovery worker. No legacy Functions or bindings.
const RECOVERY_POLICY='jarvis-readonly-no-ai-v1';
const RECOVERY_HTML=__RECOVERY_HTML_JSON__;
const headers={'cache-control':'no-store','x-jarvis-recovery-policy':RECOVERY_POLICY,'x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"};
export default {async fetch(request){
 const path=new URL(request.url).pathname;
 if(['GET','HEAD'].includes(request.method)&&['/','/index.html'].includes(path))return new Response(request.method==='HEAD'?null:RECOVERY_HTML,{headers:{...headers,'content-type':'text/html; charset=utf-8'}});
 if(request.method==='GET'&&path==='/__recovery__')return Response.json({policy:RECOVERY_POLICY,aiEnabled:false,apiWritesEnabled:false},{headers});
 return new Response(request.method==='HEAD'?null:JSON.stringify({error:'復旧モードです。実AI・API・保存・外部連携は停止しています。既存データは削除していません。',code:'RECOVERY_READ_ONLY',policy:RECOVERY_POLICY}),{status:503,headers:{...headers,'content-type':'application/json; charset=utf-8'}});
}};
