// Visual state only. No audio analysis, network, storage or background polling.
export function initCoreState(element, doc = document) {
  const flags={listening:false,thinking:false,speaking:false};
  let errorTimer, speechToken=0, failed=false;
  const render=()=>{
    element.dataset.state=failed?'error':flags.listening?'listening':flags.thinking?'thinking':flags.speaking?'speaking':'idle';
    element.classList.toggle('core-paused',doc.hidden);
    if(element.dispatchEvent)element.dispatchEvent(new CustomEvent('core-state',{detail:{state:element.dataset.state,...flags}}));
  };
  const set=(key,value)=>{if(key in flags){flags[key]=Boolean(value);render();}};
  const error=()=>{failed=true;clearTimeout(errorTimer);render();errorTimer=setTimeout(()=>{failed=false;render();},1400);};
  const stopSpeech=()=>{speechToken++;set('speaking',false);};
  const trackSpeech=utterance=>{
    const token=++speechToken;
    utterance.onstart=()=>{if(token===speechToken)set('speaking',true);};
    utterance.onend=()=>{if(token===speechToken)set('speaking',false);};
    utterance.onerror=event=>{if(token!==speechToken)return;set('speaking',false);if(!['canceled','interrupted','not-allowed'].includes(event.error))error();};
  };
  doc.addEventListener('visibilitychange',render);render();
  return {set,error,stopSpeech,trackSpeech};
}
