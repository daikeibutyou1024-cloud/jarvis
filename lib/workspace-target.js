export const RELEASE_ID='jarvis-initial-v1';
export const PREVIEW_DB_ID='5ec09d38-2ed8-4c7a-ba67-bfd9c2ed32d0';
export const PRODUCTION_DB_ID='4cae3d2a-eff6-4a1d-871e-56491bdf082a';
const preview=/^(?:[a-f0-9]{8}|feature-ai-business-rebuild)\.asset-simulator-87y\.pages\.dev$/;
const fixed='asset-simulator-87y.pages.dev';
function safeURL(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.port&&!u.username&&!u.password?u:null;}catch{return null;}}
export function workspaceTarget(request,env){
 const u=safeURL(request.url);if(!u)return null;
 if(env.CF_PAGES_BRANCH==='feature/ai-business-rebuild'&&preview.test(u.hostname))return {kind:'preview',databaseId:PREVIEW_DB_ID,marker:'jarvis-preview'};
 if(env.CF_PAGES_BRANCH!=='main'||env.JARVIS_RELEASE_ID!==RELEASE_ID||env.JARVIS_CLOUD_DB_ID!==PRODUCTION_DB_ID)return null;
 const deployed=safeURL(env.CF_PAGES_URL);
 if(!deployed||!(deployed.hostname===fixed||/^[a-f0-9]{8}\.asset-simulator-87y\.pages\.dev$/.test(deployed.hostname)))return null;
 if(u.hostname!==fixed&&u.hostname!==deployed.hostname)return null;
 return {kind:'production',databaseId:PRODUCTION_DB_ID,marker:'jarvis-production'};
}
export const workspaceHost=(request,env)=>Boolean(workspaceTarget(request,env));
