// Pure schedule definitions shared by local and persistent mock execution. No I/O.
export const STEPS=Object.freeze([
 {key:'collect',time:'12:00',minute:720},{key:'themes',time:'14:00',minute:840},
 {key:'content',time:'16:00',minute:960},{key:'save',time:'18:00',minute:1080},{key:'report',time:'19:30',minute:1170},
].map(Object.freeze));
export function jstSlot(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))throw Error('時刻はタイムゾーン付きISO形式で指定してください');
 const now=Date.parse(value),inputDay=value.slice(0,10);if(!Number.isFinite(now)||new Date(inputDay+'T00:00:00Z').toISOString().slice(0,10)!==inputDay)throw Error('時刻が不正です');
 const shifted=new Date(now+9*3600000);return {now,day:shifted.toISOString().slice(0,10),minute:shifted.getUTCHours()*60+shifted.getUTCMinutes()};
}
