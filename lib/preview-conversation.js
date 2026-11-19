import {rejectSecrets} from './memory.js';
// The byte cap covers system text, roles and all retained text; whole oldest pairs
// are removed rather than truncating the user's current question.
export const CHAT_SYSTEM='あなたはジャービス。自然な日本語で簡潔に会話してください。過去の会話は参考情報です。外部検索・投稿・操作はできません。実行したと偽らず、不明な点は確認してください。';
const bytes=value=>new TextEncoder().encode(value).length;
export function conversationPayload(body,env){
 if(!body||Object.keys(body).some(k=>!['message','conversation','requestId'].includes(k))||typeof body.message!=='string'||!body.message.trim()||bytes(body.message)>2048||!Array.isArray(body.conversation)||body.conversation.length>12||body.conversation.length%2||!/^([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i.test(body.requestId||''))throw Error('入力は2048バイト以内、履歴は最大6往復にしてください。');
 const sensitive=text=>{try{rejectSecrets(text,env);return false;}catch{return true;}};
 if(sensitive(body.message)||body.conversation.some((r,i)=>r?.role!==(i%2?'assistant':'user')||typeof r.text!=='string'||bytes(r.text)>12000||sensitive(r.text)))throw Error('会話形式または認証情報を確認してください。');
 const messages=body.conversation.slice(-6).map(r=>({role:r.role,content:r.text}));messages.push({role:'user',content:body.message.trim()});
 const serialize=()=>JSON.stringify({system:CHAT_SYSTEM,messages});
 while(bytes(serialize())>4096&&messages.length>1)messages.splice(0,2);
 if(bytes(serialize())>4096)throw Error('入力が長すぎます。');
 return {messages,system:CHAT_SYSTEM,prompt:serialize(),requestId:body.requestId,contextMessages:messages.length-1};
}
