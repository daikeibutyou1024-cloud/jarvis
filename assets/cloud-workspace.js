// Separate in-memory cloud view: never import/replace the legacy localStorage keys.
export function cloudWorkspace(request){
 let data={enabled:false,packs:[],jobs:[],reports:[]},ready=false,error=null,inflight=null;
 function validate(value){if(typeof value?.enabled!=='boolean'||(value.enabled&&!['packs','jobs','reports'].every(k=>Array.isArray(value[k]))))throw Error('クラウド応答を確認できません。既存データは保持しています');return value;}
 async function refresh(){if(inflight)return inflight;inflight=(async()=>{try{data=validate(await request('/api/autonomous'));ready=true;error=null;return data;}catch(e){error=e;throw e;}finally{inflight=null;}})();return inflight;}
 async function mutate(body){if(!ready)await refresh();if(error)throw Error('クラウド状態が未確認です。「クラウド状態を再取得」から確認してください');if(!data.enabled)throw Error('クラウド保存は未有効です');try{const result=validate(await request('/api/autonomous','POST',body));if(!result.enabled||!result.pack)throw Error('クラウド保存の確定結果を確認できません');data=result;error=null;return result;}catch(e){error=e;throw e;}}
 return {refresh,mutate,get data(){return data;},get ready(){return ready;},get error(){return error;}};
}
