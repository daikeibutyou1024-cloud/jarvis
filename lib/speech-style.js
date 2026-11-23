// Spoken-copy formatting and device-local preferences. Never changes displayed amounts.
export const DEFAULT_STYLE={rate:.95,pitch:1,voiceURI:''};
export function speechStyle(value){return {rate:typeof value?.rate==='number'&&Number.isFinite(value.rate)&&value.rate>=.75&&value.rate<=1.25?value.rate:DEFAULT_STYLE.rate,pitch:typeof value?.pitch==='number'&&Number.isFinite(value.pitch)&&value.pitch>=.8&&value.pitch<=1.2?value.pitch:DEFAULT_STYLE.pitch,voiceURI:typeof value?.voiceURI==='string'&&value.voiceURI.length<=256?value.voiceURI:''};}
export function chooseJapaneseVoice(voices,uri=''){
 const japanese=voices.filter(v=>/^ja(?:[-_]|$)/i.test(v.lang||''));const requested=japanese.find(v=>(v.voiceURI||v.name)===uri);if(requested)return requested;
 const score=v=>(/premium|enhanced|高品質|拡張/i.test(v.name||'')?40:0)+(/siri/i.test(v.name||'')?20:0)+(v.localService?8:0)+(v.default?4:0)+(/kyoko|otoya|hattori/i.test(v.name||'')?2:0);
 return japanese.map((v,i)=>({v,i,s:score(v)})).sort((a,b)=>b.s-a.s||a.i-b.i)[0]?.v;
}
export function japaneseNumber(value){
 const raw=String(value),clean=raw.replaceAll(',','');if(raw.includes(',')&&!/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(raw))return raw;if(!/^[+-]?\d{1,20}(?:\.\d{1,8})?$/.test(clean))return raw;
 const sign=clean[0]==='-'?'マイナス':clean[0]==='+'?'プラス':'',[integer,decimal]=clean.replace(/^[+-]/,'').split('.'),digits='零一二三四五六七八九',units=['','万','億','兆','京'];let n=BigInt(integer),groups=[],i=0;
 const small=x=>{let s='';for(const [p,u] of [[1000,'千'],[100,'百'],[10,'十'],[1,'']]){const d=Math.floor(x/p);if(d)s+=(d===1&&p>1?'':digits[d])+u;x%=p;}return s;};
 while(n){const g=Number(n%10000n);if(g)groups.unshift(small(g)+units[i]);n/=10000n;i++;}
 return sign+(groups.join('')||'ゼロ')+(decimal!==undefined?'点'+[...decimal].map(x=>x==='0'?'ゼロ':digits[Number(x)]).join(''):'');
}
export function naturalJapanese(text){
 return String(text).replace(/BTC\s*\/\s*JPY/gi,'ビットコイン円').replace(/\bBTC\b/g,'ビットコイン').replace(/\bbitbank\b/gi,'ビットバンク').replace(/\bETF\b/g,'イーティーエフ')
 .replace(/\bRSI\s*(\d*)/gi,(_,n)=>'アールエスアイ'+(n?japaneseNumber(n):''))
 .replace(/\bMA\s*(\d+)/gi,(_,n)=>japaneseNumber(n)+'期間の移動平均')
 .replace(/([+-]?\d[\d,]*(?:\.\d+)?)\s*(円|米ドル|USD|[%％])/g,(_,n,u)=>japaneseNumber(n)+(u==='%'||u==='％'?'パーセント':u==='USD'?'米ドル':u))
 .replace(/(^|[^A-Za-z0-9])([+-]?\d+\.\d+)(?![A-Za-z0-9])/g,(_,prefix,n)=>prefix+japaneseNumber(n))
 .replace(/[ \t]*\n+[ \t]*/g,'。').replace(/。{2,}/g,'。');
}
