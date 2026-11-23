import {rejectSecrets} from './memory.js';
// Same normalization for typed commands, final ASR transcripts and follow-up routing.
export function normalizeCoreCommand(value){
 let text=String(value??'').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g,'').trim();
 const wake=/^(?:(?:ねえ|もしもし|ヘイ)[、,:!。\s]*)?(?:ジャービス|ジャーヴィス|ジャビス|j\s*\.?\s*a\s*\.?\s*r\s*\.?\s*v\s*\.?\s*i\s*\.?\s*s\.?)[、,:!。\s]*/i;
 for(let i=0;i<3;i++){const next=text.replace(wake,'');if(next===text)break;text=next;}
 return text.replace(/[。.!?！？，、\s]+$/u,'').trim();
}
export function isBTCReportCommand(value){
 let text=normalizeCoreCommand(value).replace(/\s+/g,'').replace(/ビーティーシー/g,'BTC');
 text=text.replace(/^(?:今日|きょう|本日|現在|今|最新)(?:の)?/u,'');
 if(/^(?:は)?買い時(?:ですか)?$/u.test(text))return true;
 if(/^(?:ビットコイン|BTC)(?:は|が)?(?:上がりそう|下がりそう)(?:ですか)?$/iu.test(text))return true;
 const ask='(?:(?:を)?(?:して(?:ください|下さい)?|教えて(?:ください|下さい)?|報告して(?:ください|下さい)?|確認して(?:ください|下さい)?|更新して(?:ください|下さい)?|お願い(?:します)?|ください|下さい)|は(?:どう(?:ですか)?|いくら(?:ですか)?)?)?';
 return new RegExp('^(?:(?:ビットコイン|BTC)(?:の)?(?:市場の)?(?:報告|レポート|状況|価格|相場|ニュース|市場レポート)|(?:報告|相場))'+ask+'$','iu').test(text);
}
const intents=new Set(['btc_report','btc_followup','weather','tasks','greeting','help','history','unsupported','secret_blocked','pending']);
const statuses=new Set(['received','processing','success','acquisition_failed','partial_acquisition','failed','blocked','recognition_stopped']);
const reasons={received:'入力を受け付けました。',processing:'判定した処理を実行しています。',success:'処理が完了しました。',acquisition_failed:'BTCコマンドは認識しましたが、公開データの取得・鮮度を確認できません。',partial_acquisition:'BTCコマンドは認識しました。一部の相場・指標・ニュースを取得できません。',failed:'判定した処理に失敗しました。自動再試行しません。',blocked:'機密情報の可能性があるため入力内容を診断に記録しません。',recognition_stopped:'ブラウザの認識・確定を完了できませんでした。再開できます。'};
const codes=new Set(['NETWORK','TIMEOUT','FORMAT','UPSTREAM_HTTP','NETWORK_OR_READ','FETCH_FAILED','STALE_TICKER','REDIRECT_BLOCKED','PROVIDER_ERROR','SCHEMA','TICKER_SCHEMA','INVALID_JSON','CONTENT_TYPE','BODY_LIMIT','EMPTY_BODY','ROW_LIMIT','TIMESTAMP','READ_FAILURE']);
const stages=new Set(['fetch','response','json','schema','candles','ticker','freshness','parse','plan','read']);
const sources=new Set(['btc-report','bitbank','bitbank-ticker','bitbank-candles','fed','sec','coindesk']);
export function safeCommandDiagnostic(raw,{source='text',intent='pending',status='received',password='',code,failures=[]}={}){
 const text=String(raw??''),scan=text.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g,'');let sensitive=text.length>2000||/(?:password|パスワード|secret|シークレット|api[ _-]?key|APIキー|access[ _-]?token|アクセストークン|Bearer|\bsk-[A-Za-z0-9_-]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b\d{2,4}-\d{2,4}-\d{3,4}\b)/i.test(scan);
 try{rejectSecrets(text,{JARVIS_ACCESS_PASSWORD:password});rejectSecrets(scan,{JARVIS_ACCESS_PASSWORD:password.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g,'')});}catch{sensitive=true;}
 const state=statuses.has(status)?status:'failed';return {at:Date.now(),source:source==='voice'?'voice':'text',input:sensitive?'[機密情報の可能性があるため非表示]':text,normalized:sensitive?'[非表示]':normalizeCoreCommand(text),intent:sensitive?'secret_blocked':intents.has(intent)?intent:'pending',status:sensitive?'blocked':state,reason:!sensitive&&intent==='unsupported'?'正規化後の文が対応する無料コマンドに一致しませんでした。':reasons[sensitive?'blocked':state],...(!sensitive&&codes.has(code)?{code}:{}),failures:sensitive?[]:Array.isArray(failures)?failures.slice(0,8).map(f=>({source:sources.has(f?.sourceId)?f.sourceId:'unknown',code:codes.has(f?.code)?f.code:'UNAVAILABLE',stage:stages.has(f?.stage)?f.stage:'unknown',...(Number.isInteger(f?.httpStatus)&&f.httpStatus>=100&&f.httpStatus<=599?{httpStatus:f.httpStatus}:{})})):[],persisted:false};
}
