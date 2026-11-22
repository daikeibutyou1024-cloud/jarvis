import {createVoiceInput} from './voice-input.js';
// Modes share exactly one recognizer. Only an explicitly started conversation can send.
export function createVoiceSession({Recognition,getText,onText,onListening,onState,authorize,send,speak,cancelSpeech,isBusy=()=>false,isHidden=()=>false,canConverse=()=>true,singleTurn=()=>false,turnLimit=()=>Infinity,modeLabel=null,blockedReason=()=> '実AIは費用・残高未確認のため停止中です。Previewモック回答を選択してください。',now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}) {
 const label=()=>modeLabel?modeLabel():singleTurn()?'Claude実AI（1回テスト）':'Previewモック';
 let mode='dictation',running=false,epoch=0,phase='idle',timer=null,lastVoiceText='',turns=0;
 const status=(state,text)=>{phase=state;onState(state,text);};
 function stop(message='会話を停止しました。入力した文章は保持しています。'){
  running=false;epoch++;clearTimer(timer);timer=null;input.stop(message,{abort:true});cancelSpeech();status('idle',message);
 }
 const pause=message=>{stop(message);status('paused',message+' オーブをタップして再開できます。');};
 function listen(token){
  if(token!==epoch||!running)return;
  if(isHidden()||isBusy()){pause('画面または処理状態を確認してください。');return;}
  status('listening',`聞いています。約3秒の無音で確定し、${label()}へ自動送信します。`);input.start();
 }
 async function complete(result){
  if(!running||mode!=='conversation'||!['listening','starting','stopping'].includes(phase))return;
  if(result.error||result.reason==='error'){pause('音声認識を終了しました。文章を確認してください。');return;}
  const text=result.confirmedText?.trim();
  if(!text||text!==result.text.trim()){pause('発話を確定できませんでした。途中の文章は入力欄に残しています。');return;}
  const token=epoch;status('finalizing','発話の終わりを確認しています…');
  const dispatch=async()=>{
   timer=null;if(token!==epoch||!running||phase!=='finalizing')return;
   if(isHidden()||isBusy()||!canConverse()){pause('送信できる状態ではありません。実AIは停止中です。');return;}
   status('processing',`${label()}の回答を待っています。自動再送はしません。`);
   try{const answer=await send(text);if(token!==epoch||!running)return;if(!answer?.trim())throw Error('回答が空でした。');status('speaking',`${label()}の回答を読み上げています。`);await speak(answer);if(token!==epoch||!running)return;turns++;if(turns>=turnLimit()){stop('音声会話の連続送信上限です。オーブをタップして再開してください。');return;}if(singleTurn()){stop('1回限定の実AIテストが終了しました。追加送信は禁止しています。');return;}listen(token);}
   catch(error){if(token===epoch&&running)pause(error.message||'通信または読み上げに失敗しました。');}
  };
  const remaining=Math.max(0,3000-(now()-result.lastActivityAt));
  if(remaining)timer=setTimer(dispatch,remaining);else void dispatch();
 }
 const input=createVoiceInput({Recognition,now,setTimer,clearTimer,isHidden,cancelSpeech,getText:()=>mode==='conversation'?'':getText(),
  onText:text=>{if(mode==='conversation')lastVoiceText=text;onText(text);},onListening,
  onState:(state,text)=>{if(mode==='dictation'){if(state==='idle'||state==='error')running=false;status(state,text);}else if(running&&['starting','listening','stopping'].includes(state)){if(state==='starting')status(state,'マイクを準備しています…');else if(state==='listening')status(state,`聞いています。約3秒の無音で確定し、${label()}へ自動送信します。`);else status(state,'発話を確定しています…');}else if(running&&state==='error')pause(text);},
  onComplete:result=>void complete(result)});
 async function startConversation(){
  if(running){stop();return;}
  if(isHidden()||isBusy())return;
  if(!canConverse()){status('paused',blockedReason());return;}
  if(getText().trim()&&getText()!==lastVoiceText){status('paused','入力中の文章を先に送信または退避してください。上書きしません。');return;}
  cancelSpeech();mode='conversation';turns=0;running=true;const token=++epoch;status('authorizing','音声会話の認証を確認しています…');
  try{const authorized=await authorize();if(!authorized){if(token===epoch&&running)pause('認証をキャンセルしました。');return;}if(token===epoch&&running){if(!canConverse()){pause('実AIは停止中です。Previewモックのみ利用できます。');return;}listen(token);}}
  catch(error){if(token===epoch&&running)pause(error.message||'認証を確認できませんでした。');}
 }
 function startDictation(){if(running&&mode==='dictation'){stop();return;}stop();if(isBusy()||isHidden())return;mode='dictation';running=true;input.start();}
 return {start:startConversation,startConversation,startDictation,stop,get active(){return running;},get mode(){return mode;},get phase(){return phase;}};
}
