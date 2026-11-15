// Isolated diagnostics: no imports, DB access, provider calls or mutation handlers.
const branch='feature/ai-business-rebuild';
const previewHost=/^(?:[a-f0-9]{8}|feature-ai-business-rebuild)\.asset-simulator-87y\.pages\.dev$/;
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
function allowedURL(value){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&previewHost.test(u.hostname)&&u.pathname==='/'&&!u.search&&!u.hash;}catch{return false;}
}
export function onRequest({request,env}){
 // Authenticate before inspecting or exposing any diagnostic state.
 if(typeof env.JARVIS_ACCESS_PASSWORD!=='string'||!env.JARVIS_ACCESS_PASSWORD||request.headers.get('x-jarvis-password')!==env.JARVIS_ACCESS_PASSWORD)return json({error:'認証が必要です'},401);
 if(request.method!=='GET')return json({error:'GETのみ利用できます'},405);
 const u=new URL(request.url);
 if(!allowedURL(u.origin)||(request.headers.get('Origin')&&request.headers.get('Origin')!==u.origin))return json({error:'対象Previewのみ利用できます'},403);
 const b=env.CF_PAGES_BRANCH;
 // Missing branch metadata is precisely what this endpoint diagnoses.
 if(b!==undefined&&b!==''&&b!==branch)return json({error:'対象ブランチ以外では利用できません'},403);
 const branchPresent=typeof b==='string'&&b.length>0;
 const v=env.CF_PAGES_URL,urlPresent=typeof v==='string'&&v.length>0;
 return json({schema:'jarvis-preview-runtime-v1',branch:{present:branchPresent,matchesExpected:b===branch},url:{present:urlPresent,matchesAllowedPreview:urlPresent&&allowedURL(v)},mockEnabled:env.PREVIEW_MOCK_AUTOMATION_ENABLED==='true'});
}
