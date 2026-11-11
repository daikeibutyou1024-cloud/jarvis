import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)?value.toLowerCase():null;
export function inspectPagesProject(project){
 const production=uuid(project?.deployment_configs?.production?.d1_databases?.JARVIS_DB?.id),preview=uuid(project?.deployment_configs?.preview?.d1_databases?.JARVIS_DB?.id);
 const source=project?.source?.config,repositoryMatches=source?.owner==='daikeibutyou1024-cloud'&&source?.repo_name==='jarvis';
 const variables=project?.deployment_configs?.preview?.env_vars||{};
 return {schema:'jarvis-preview-config-check-v1',checkedAt:new Date().toISOString(),configurationOnly:true,repositoryMatches,productionDatabaseId:production,previewDatabaseId:preview,separation:!production||!preview?'unverified':production===preview?'shared_database_unsafe':'different_database_ids',previewVariablePresence:Object.fromEntries(['JARVIS_ACCESS_PASSWORD','AI_MONTHLY_BUDGET_USD','AI_PRICING_JSON','AI_OPENING_SPEND_USD_JSON','ANTHROPIC_API_KEY','OPENAI_API_KEY'].map(key=>[key,Object.hasOwn(variables,key)])),liveDeploymentVerified:false,readyForPreviewWrites:false,notice:'設定上のDB ID比較です。現行Preview配備に同じ設定が適用された証明、課金設定、DBの内容・書込・復元の検証は別途必要です。環境変数の値・秘密は出力しません'};
}
export async function checkCloudflare(env,fetchOnce=fetch){
 const required=['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_PAGES_PROJECT','CLOUDFLARE_API_TOKEN'],missing=required.filter(k=>!env[k]);
 if(missing.length)return {result:'blocked',missing,externalRequests:0};
 if(!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID)||! /^[a-z0-9][a-z0-9-]{0,62}$/.test(env.CLOUDFLARE_PAGES_PROJECT))throw Error('CloudflareのアカウントID・プロジェクト名を確認してください');
 const base='https://api.cloudflare.com/client/v4/accounts/'+env.CLOUDFLARE_ACCOUNT_ID;
 const get=async path=>{const response=await fetchOnce(base+path,{method:'GET',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN}});if(!response.ok)throw Error('Cloudflareの読取に失敗しました。対象アカウントとPages Read・D1 Read権限を確認してください');const data=await response.json();if(data.success!==true)throw Error('Cloudflareの読取結果を確認できませんでした');return data.result;};
 const project=await get('/pages/projects/'+encodeURIComponent(env.CLOUDFLARE_PAGES_PROJECT)),report=inspectPagesProject(project);report.databaseMetadata=[];
 if(report.separation==='different_database_ids')for(const databaseId of [report.productionDatabaseId,report.previewDatabaseId]){const metadata=await get('/d1/database/'+databaseId);report.databaseMetadata.push({id:databaseId,idConfirmed:uuid(metadata.uuid)===databaseId});}
 return {result:report.repositoryMatches&&report.separation==='different_database_ids'&&report.databaseMetadata.every(d=>d.idConfirmed)?'configuration_checked_only':'blocked',report};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{let result;if(process.argv[2]==='--fixture'){const fixture=JSON.parse(await readFile(process.argv[3],'utf8'));result={result:'fixture_only',report:inspectPagesProject(fixture.result||fixture)};}else result=await checkCloudflare(process.env);console.log(JSON.stringify(result,null,2));if(result.result!=='configuration_checked_only')process.exitCode=2;}
 catch{console.error(JSON.stringify({result:'blocked',error:'Cloudflareの読取確認に失敗しました。権限・接続・入力形式を確認してください。生の応答や秘密は出力していません'}));process.exitCode=2;}
}
