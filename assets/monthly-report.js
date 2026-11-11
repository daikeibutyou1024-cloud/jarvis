const yen=value=>'¥'+Number(value).toLocaleString('ja-JP',{maximumFractionDigits:2});
const rate=value=>value===null?'未算出':(value*100).toFixed(2)+'%';
export function initMonthlyReport({request,say,getBusy=()=>false}){
 const $=id=>document.getElementById(id);let busy=false,next=null,loadedPeriod=null;
 $('monthly-period').value=new Date(Date.now()+9*3600000).toISOString().slice(0,7);
 async function load(after=null){
  if(busy||getBusy())return;const month=$('monthly-period').value;
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)){say('対象月を指定してください');return;}
  if(after!==null&&month!==loadedPeriod){say('対象月が変わりました。先に月次の記録を取得してください');return;}
  busy=true;for(const id of ['monthly-period','monthly-refresh','monthly-next'])$(id).disabled=true;
  try{
   const params=new URLSearchParams({period:month});if(after!==null)params.set('after',after);
   const d=await request('/api/business/monthly-report?'+params);next=d.nextCursor;loadedPeriod=month;
   $('monthly-summary').textContent=`${d.period} / ${d.asOf}時点 / このページ ${d.projects.length}件。${d.coverage.records?'共有記録あり':'共有記録は未連携'}。${d.notice}`;
   const root=$('monthly-projects');root.replaceChildren();
   for(const p of d.projects){
    const article=document.createElement('article'),h=document.createElement('h3'),money=document.createElement('p'),publications=document.createElement('p'),list=document.createElement('ul'),suggestions=document.createElement('p');
    h.textContent=`${p.title} / ${p.projectId||'案件未指定'}${p.revision!==null?' / 現在の版'+p.revision:''}`;const t=p.recordedTotals;
    money.textContent=t?`入力済み収支 ${t.entries}件：売上 ${yen(t.revenue)} / 経費 ${yen(t.expense)} / API費用 ${yen(t.api)} / 入力差額 ${yen(t.difference)}（実利益は未取得）`:'収支未入力（売上0円とは判断できません）';
    if(p.excludedCurrencyEntries)money.textContent+=` / 通貨不一致 ${p.excludedCurrencyEntries}件を除外`;
    publications.textContent=p.manualPublicationRecords===null?'この月の手動公開記録は未入力です（外部未確認）':`手動公開の申告記録 ${p.manualPublicationRecords}件（外部未確認）`;
    for(const m of p.metrics){const li=document.createElement('li');li.textContent=`${m.channel}：アクセス ${m.visits} / クリック ${m.clicks} / 成果 ${m.conversions} / CTR ${rate(m.ctr)} / 成果率 ${rate(m.conversionRate)}`;list.append(li);}
    if(!p.metrics.length)list.textContent='成果の計測値は未入力です';suggestions.textContent=[...p.suggestions,p.suggestionsBasis].join('\n');article.append(h,money,publications,list,suggestions);root.append(article);
   }
   if(!d.projects.length)root.textContent='この範囲の案件・入力記録はありません';$('monthly-next').hidden=next===null;say('入力済みの記録を案件別に集計しました。AIや外部サービスは利用していません。');
  }catch(e){next=null;loadedPeriod=null;$('monthly-next').hidden=true;$('monthly-projects').replaceChildren();$('monthly-summary').textContent='取得できませんでした。以前の結果を現在の集計として扱わないでください。';say(e.message);}
  finally{busy=false;for(const id of ['monthly-period','monthly-refresh','monthly-next'])$(id).disabled=false;}
 }
 $('monthly-refresh').onclick=()=>load();$('monthly-next').onclick=()=>next!==null?load(next):undefined;
}
