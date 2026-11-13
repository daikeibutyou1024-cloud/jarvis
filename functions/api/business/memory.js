import {denied,responseJSON as json} from '../../../lib/research-network.js';
import {memoryList,saveMemory,memoryContext,findWork,rejectSecrets,MEMORY_LIMITS} from '../../../lib/memory.js';
async function gate(request,env){const auth=denied(request,env);if(auth)return auth;if(env.JARVIS_MEMORY_ENABLED!=='true')return json({error:'会話記憶は未設定です。別途DB準備と有効化の承認が必要です',code:'MEMORY_DISABLED'},503);if(!env.JARVIS_DB||!await env.JARVIS_DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jarvis_memories'").first())return json({error:'記憶用テーブルは未準備です',code:'MEMORY_UNAVAILABLE'},503);}
async function safeList(db,env){return (await memoryList(db)).filter(r=>{try{rejectSecrets([r.user,r.assistant,r.text,r.projectId].filter(Boolean).join('\n'),env);return true;}catch{return false;}});}
export async function onRequestGet({request,env}){const blocked=await gate(request,env);if(blocked)return blocked;return json({items:await safeList(env.JARVIS_DB,env),limits:MEMORY_LIMITS,scope:'同じアクセス認証を共有するワークスペース。個人別ではありません'});}
export async function onRequestPost({request,env}){
 const blocked=await gate(request,env);if(blocked)return blocked;
 try{const raw=await request.text();if(new TextEncoder().encode(raw).length>65536)throw Error('要求が大きすぎます');const b=JSON.parse(raw),db=env.JARVIS_DB;
 if(['context','find'].includes(b.action)){if(typeof b.query!=='string'||b.query.length>2000)throw Error('検索文は2000文字以内です');rejectSecrets(b.query,env);if(b.action==='find')return json({projects:await findWork(db,b.query,env),notice:'最新200案件から最大10候補。候補がない場合は未取得です'});return json({context:memoryContext((await safeList(db,env)).filter(x=>!b.excludeHistory||x.kind!=='history'),b.query)});}
 if(b.action==='save')return json(await saveMemory(db,b,env),201);
 if(b.action==='delete'){if(!/^[-a-zA-Z0-9]{1,80}$/.test(b.id)||!Number.isSafeInteger(b.expectedVersion))throw Error('記憶ID・版を指定してください');const r=await db.prepare('DELETE FROM jarvis_memories WHERE id=? AND version=?').bind(b.id,b.expectedVersion).run();if(!r.meta?.changes)throw Error('更新競合です。再読込してください');return json({deleted:true});}
 throw Error('操作が不正です');
 }catch{return json({error:'記憶の形式・秘密情報・保存上限・更新競合を確認してください。既存記事は変更していません',code:'MEMORY_REJECTED'},400);}
}
