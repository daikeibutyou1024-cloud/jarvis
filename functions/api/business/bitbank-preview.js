import {previewHost,validSession} from '../../../lib/preview-session.js';
import {mockAssetReport} from '../../../lib/bitbank-report.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
export async function onRequest({request,env}){
 if(!previewHost(request,env))return json({error:'対象Previewのみ利用できます'},403);
 if(!await validSession(request,env))return json({error:'認証が必要です'},401);
 if(request.method!=='GET')return json({error:'参照専用です'},405);
 const u=new URL(request.url);if(u.search)return json({error:'実接続や任意の対象指定はできません'},400);
 // Always synthetic. Even configured secrets or activation flags cannot initiate I/O.
 return json(mockAssetReport());
}
