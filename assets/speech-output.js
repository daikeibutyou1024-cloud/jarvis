// Shared device TTS. Audible gesture preparation only; no silent audio or resume loops.
export function splitSpeechText(text,limit=140){
 const chars=Array.from(String(text));const chunks=[];
 while(chars.length){let end=Math.min(limit,chars.length);if(end<chars.length){for(let i=end-1;i>=Math.floor(limit/3);i--)if(/[。！？!?\n]/u.test(chars[i])||(chars[i]==='.'&&/\s/.test(chars[i+1]||''))){end=i+1;break;}}const part=chars.splice(0,end).join('');if(part.trim())chunks.push(part);}
 return chunks;
}
export function createSpeechOutput({synth,Utterance,track=()=>{},onStop=()=>{},canSpeak=()=>true,setTimer=setTimeout,clearTimer=clearTimeout}){
 let current=null,initialized=false,voices=[],remaining='';
 const refreshVoices=()=>{try{voices=Array.from(synth?.getVoices?.()||[]);}catch{voices=[];}};
 refreshVoices();synth?.addEventListener?.('voiceschanged',refreshVoices);
 function stop(){const old=current;old?.finish(Error('読み上げを停止しました'));current=null;remaining='';onStop();try{synth?.cancel();}catch{}}
 function speak(text,{rate=1,userInitiated=false}={}){
  stop();if(!synth||!Utterance)return Promise.reject(Error('読み上げに非対応です。画面の回答を確認してください。'));
  if(!canSpeak())return Promise.reject(Error('音声認識中は再生できません。マイクを停止して「音声で再生」を押してください。'));
  if(typeof text!=='string'||!text.trim()||Array.from(text).length>20000)return Promise.reject(Error('読み上げる文章の長さを確認してください。'));
  refreshVoices();if(userInitiated){try{if(synth.paused)synth.resume?.();}catch{}}
  const chunks=splitSpeechText(text),speed=Math.min(2,Math.max(.6,Number(rate)||1));
  return new Promise((resolve,reject)=>{
   const utterances=chunks.map(t=>{const u=new Utterance(t);u.lang='ja-JP';u.rate=speed;u.volume=1;const voice=voices.find(v=>/^ja[-_]JP$/i.test(v.lang)&&v.default)||voices.find(v=>/^ja(?:[-_]|$)/i.test(v.lang));if(voice)u.voice=voice;return u;});
   // Track one logical output so later chunks cannot invalidate the CORE's speech token.
   track(utterances[0]);const tracked={start:utterances[0].onstart,end:utterances[0].onend,error:utterances[0].onerror};let done=false,startTimer,endTimer,index=0;
   const clear=()=>{clearTimer(startTimer);clearTimer(endTimer);};
   const finish=error=>{if(done)return;done=true;clear();remaining=error&&!/停止しました/.test(error.message)?chunks.slice(index).join(''):'';if(current===job)current=null;onStop();error?reject(error):resolve();};
   const job={finish,utterances};current=job;
   function fail(error,event){if(done)return;initialized=false;tracked.error?.(event||{error:'synthesis-failed'});finish(error);try{synth.cancel();}catch{}}
   function play(){
    if(done)return;const i=index,u=utterances[i];let started=false;const valid=()=>!done&&current===job&&index===i;
    u.onstart=e=>{if(!valid()||started)return;started=true;initialized=true;clearTimer(startTimer);if(i===0)tracked.start?.(e);};
    u.onend=e=>{if(!valid())return;if(!started){fail(Error('音声の再生開始を確認できません。「音声で再生」を押してください。'));return;}clear();index++;if(index===chunks.length){tracked.end?.(e);finish();}else play();};
    u.onerror=e=>{if(valid())fail(Error('音声を再生できませんでした。「音声で再生」を押してください。'),e);};
    startTimer=setTimer(()=>{if(valid())fail(Error('自動音声再生が制限されています。「音声で再生」を押してください。'));},4000);
    endTimer=setTimer(()=>{if(valid())fail(Error('読み上げが中断しました。「音声で再生」で残りを再生できます。'));},Math.min(90000,Math.max(15000,Array.from(chunks[i]).length*450/speed+10000)));
    try{synth.speak(u);}catch{fail(Error('音声を再生できませんでした。「音声で再生」を押してください。'));}
   }
   play();
  });
 }
 function prepare({text='音声の準備ができました。'}={}){refreshVoices();try{if(synth?.paused)synth.resume?.();}catch{}return initialized?Promise.resolve(true):speak(text,{userInitiated:true}).then(()=>true);}
 return {speak,stop,prepare,get ready(){return initialized;},get remainingText(){return remaining;},get active(){return current!==null;}};
}
export function createWelcome({speak,onFallback=()=>{},text}){
 let attempted=false,done=false,pending=null,epoch=0;
 function play({userInitiated=false}={}){
  if(done)return Promise.resolve(true);if(pending)return pending;if(attempted&&!userInitiated)return Promise.resolve(false);
  attempted=true;const token=++epoch;onFallback(false);
  // Invoke speech immediately inside the user gesture, before any await/auth request.
  pending=Promise.resolve().then(()=>{});let speech;try{speech=speak(text,{rate:0.95});}catch(error){speech=Promise.reject(error);}
  pending=Promise.resolve(speech).then(()=>{if(token!==epoch)return false;done=true;onFallback(false);return true;},()=>{if(token===epoch)onFallback(true);return false;}).finally(()=>{if(token===epoch)pending=null;});return pending;
 }
 function cancel(){epoch++;pending=null;}
 return {play,cancel,get active(){return pending!==null;},get completed(){return done;}};
}
