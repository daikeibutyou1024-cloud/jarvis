import {denied,responseJSON as json} from '../../../lib/research-network.js';
import {inspectPreflight} from '../../../lib/preflight.js';
export async function onRequestGet({request,env}){
 const auth=denied(request,env);if(auth)return auth;
 try{return json(await inspectPreflight(env));}
 catch{return json({error:'確認結果を取得できませんでした。データ・設定は変更していません'},503);}
}
