import {normalizeCoreCommand,isBTCReportCommand} from './core-command.js';
import {btcFollowUp} from './btc-followup.js';
// No model clients, arbitrary URL, retry or write-to-service dependencies.
export function createFreeDialogue({archive,report,weather,tasks,onDiagnostic=()=>{}}){
 let restored=false,btc=null,topic='',recent=[],locked=false,epoch=0;
 async function restore(){if(restored)return;const token=epoch;const [rows,snapshot]=await Promise.all([archive.page({limit:20}),archive.context('btc')]);if(token!==epoch)throw Error('認証状態が変わりました。');recent=rows.reverse();btc=snapshot?.schema==='jarvis-btc-report-v1'&&snapshot.judgment&&Array.isArray(snapshot.forecasts)&&Array.isArray(snapshot.news)?snapshot:null;topic=recent.at(-1)?.topic||'';restored=true;locked=false;}
 async function answer(raw){const token=epoch;await restore();if(locked||token!==epoch)throw Error('会話が停止しました。');const diagnose=event=>{if(token===epoch&&!locked)onDiagnostic(event);};const text=normalizeCoreCommand(raw),explicitBTC=/BTC|ビットコイン|レポート/i.test(text);let response,next='general',context=null;
 if(isBTCReportCommand(raw)){next='btc';diagnose({intent:'btc_report',status:'processing'});let r;try{r=await report();}catch(error){diagnose({intent:'btc_report',status:'acquisition_failed',code:error.data?.diagnostic?.code,failures:[{sourceId:'btc-report',code:Number.isInteger(error.status)?'UPSTREAM_HTTP':'FETCH_FAILED',stage:Number.isInteger(error.status)?'response':'fetch',httpStatus:error.status}]});const failed=Error('BTCレポートのコマンドは認識しましたが、公開データの取得に失敗しました。通信状況を確認してください。自動再試行しません。');failed.commandIntent='btc_report';throw failed;}response=r.text;context=r.snapshot;const missing=!context?.ticker||!context?.market,newsMissing=context?.news?.some(x=>x.status==='未取得');diagnose({intent:'btc_report',status:missing||newsMissing?(context?.ticker||context?.market?'partial_acquisition':'acquisition_failed'):'success',failures:[...(context?.diagnostics||[]),...(context?.news||[]).filter(n=>n.status==='未取得').map(n=>({sourceId:n.sourceId,...n.diagnostic}))]});}
 else {const follow=btcFollowUp(btc,text,{pronounContext:topic==='btc'||explicitBTC||/さっきの.*(?:BTC|ビットコイン|報告)/i.test(text)});if(follow){response=follow;next='btc';diagnose({intent:'btc_followup',status:'success'});}
 else if(/天気|気温|降水|雨雲/.test(text)){response=await weather(text);next='weather';}
 else if(/予定|タスク|やること|業務状況|承認待ち/.test(text)){response=await tasks(text);next='tasks';}
 else if(/^(こんにちは|おはよう(?:ございます)?|こんばんは|やあ)[！!。\s]*$/.test(text))response='こんにちは。ジャービスです。無料の音声会話では、ビットコインの報告、天気、確認できる業務の記録をご案内できます。';
 else if(/^(ありがとう(?:ございます)?|助かりました)[！!。\s]*$/.test(text))response='どういたしまして。続けてお話しください。';
 else if(/何ができ|使い方|無料|有料|AI/.test(text))response='このCOREは無料の定型処理です。有料AIへは送信しません。BTC報告とその追加質問、天気、確認できるタスクや予定の状況、挨拶に対応します。自由な質問すべてに答えるAIではありません。';
 else if(/(\d+)(?:往復|件)前/.test(text)){const n=Number(text.match(/(\d+)(?:往復|件)前/)[1]),row=await archive.atOffset(n-1);response=row?'保存した会話では「'+row.user.slice(0,200)+'」と聞かれ、「'+row.assistant.slice(0,500)+'」と返答しました。取得時点の情報で、現在とは異なる場合があります。':'指定された位置の履歴は確認できません。履歴一覧をご確認ください。';}
 else if(/さっき|それ|前の話|会話履歴|何を話/.test(text)){const previous=recent.at(-1);response=previous?'直前は「'+previous.user.slice(0,120)+'」というお話でした。過去の会話は履歴一覧で確認できます。BTCの話なら「さっきのBTCの理由を教えて」と聞いてください。':'このページでは、まだ参照できる会話がありません。保存した履歴を読み込んで確認してください。';}
 else response='その質問には、無料の定型処理だけでは正確に答えられません。推測の回答や有料AIへの切り替えは行いません。BTC報告、天気、タスクの確認などでお手伝いできます。';}
 if(next!=='btc')diagnose({intent:next==='general'?/正確に答えられません/.test(response)?'unsupported':/こんにちは|どういたしまして/.test(response)?'greeting':'history':next,status:'success'});
 if(token!==epoch||locked)throw Error('会話が停止しました。');const row=await archive.append({user:raw,assistant:response,topic:next,...(context?{context}: {})});if(token!==epoch||locked)throw Error('会話が停止しました。');if(context)btc=context;topic=next;recent.push(row);if(recent.length>20)recent=recent.slice(-20);return {text:response,topic:next,record:row,warning:archive.warning};}
 function lock(){epoch++;restored=false;locked=true;btc=null;topic='';recent=[];}
 return {answer,restore,lock,get recent(){return [...recent];}};
}
