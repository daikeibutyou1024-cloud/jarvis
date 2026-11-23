import {speechStyle,chooseJapaneseVoice} from '../lib/speech-style.js';
export function initSpeechSettings({synth,storage,onChange=()=>{},doc=document}){
 const $=id=>doc.getElementById(id),key='jarvis.speech.style.v1';let saveError=false,value=speechStyle();try{value=speechStyle(JSON.parse(storage.getItem(key)));}catch{}
 const show=()=>{$('speech-rate').value=String(value.rate);$('speech-pitch').value=String(value.pitch);$('speech-rate-value').textContent=value.rate.toFixed(2)+'倍';$('speech-pitch-value').textContent=value.pitch.toFixed(2);};
 function voices(){let list=[];try{list=synth?.getVoices?.()||[];}catch{}const select=$('speech-voice');select.replaceChildren();const auto=doc.createElement('option');auto.value='';auto.textContent='自動（利用可能な日本語音声を優先）';select.append(auto);
 for(const v of list.filter(v=>/^ja(?:[-_]|$)/i.test(v.lang||''))){const o=doc.createElement('option');o.value=v.voiceURI||v.name;o.textContent=(v.name||v.lang)+(v.localService?'（端末音声）':'');select.append(o);}
 select.value=[...select.options].some(o=>o.value===value.voiceURI)?value.voiceURI:'';const selected=chooseJapaneseVoice(list,value.voiceURI);$('speech-voice-status').textContent=selected?'使用予定：'+selected.name+'。品質は端末に依存します。':'日本語音声の一覧を待っています。取得できなければOSの日本語選択を利用します。';}
 function save(event){value=speechStyle({rate:Number($('speech-rate').value),pitch:Number($('speech-pitch').value),voiceURI:event.target.id==='speech-voice'?$('speech-voice').value:value.voiceURI});saveError=false;try{storage.setItem(key,JSON.stringify(value));}catch{saveError=true;}show();voices();if(saveError)$('speech-voice-status').textContent+=' 設定を保存できません。今回の設定だけ適用します。';onChange(value);}
 for(const id of ['speech-rate','speech-pitch','speech-voice'])$(id).addEventListener('change',save);show();voices();synth?.addEventListener?.('voiceschanged',voices);return {get:()=>({...value}),refresh:voices};
}
