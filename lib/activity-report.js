export const categories={note:'note売上',affiliate:'アフィリエイト収益',other_income:'その他収益',claude:'Claude API費（手入力・請求未確認）',openai:'OpenAI API費（手入力・請求未確認）',other_expense:'その他経費',other_api:'その他API費（手入力・請求未確認）'};
export const metricFields={noteViews:'note閲覧',noteLikes:'noteスキ',xViews:'X表示',xReactions:'X反応',instagramViews:'Instagram表示',instagramReactions:'Instagram反応'};
export function dateJST(date=new Date()){return new Date(date.getTime()+9*3600000).toISOString().slice(0,10);}
export function validateMetric(row){
 if(!row.projectId||!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||!Number.isFinite(Date.parse(row.date)))throw Error('案件ID・日付を確認してください');
 const clean={projectId:row.projectId,date:row.date,published:row.published||'unknown',basis:'manual'};
 if(!['unknown','draft','published'].includes(clean.published))throw Error('公開状態が不正です');
 for(const key of Object.keys(metricFields)){const v=row[key];clean[key]=v===''||v==null?null:Number(v);if(clean[key]!==null&&(!Number.isSafeInteger(clean[key])||clean[key]<0))throw Error('成果は0以上の整数、未登録は空欄にしてください');}
 return clean;
}
export function validateMoney(row){
 if(!categories[row.category]||!/^\d{4}-\d{2}-\d{2}$/.test(row.date))throw Error('日付・区分を確認してください');
 const original=Number(row.original),currency=row.currency,rate=currency==='JPY'?1:Number(row.rate);
 if(!['JPY','USD','EUR'].includes(currency)||!Number.isFinite(original)||original<0||original>1e9||!Number.isFinite(rate)||rate<=0||rate>1e6||row.original==='')throw Error('金額・通貨・1通貨あたりの円換算レートを確認してください');
 if(currency!=='JPY'&&(!row.rateDate||!row.rateSource?.trim()))throw Error('外貨には換算日と換算根拠が必要です');
 if(!Number.isSafeInteger(Math.round(original*rate*100)))throw Error('円換算額が大きすぎます');
 return {...row,original,currency,rate,amount:Math.round(original*rate*100)/100,type:['note','affiliate','other_income'].includes(row.category)?'revenue':['claude','openai','other_api'].includes(row.category)?'api':'expense',basis:'manual'};
}
function draftDate(d){
 const value=d.activityDate||d.generation?.activityDate;if(value)return value;
 const match=typeof d.date==='string'&&d.date.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s|$)/);
 return match?`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`:null;
}
export function report({records=[],drafts=[],social=[],metrics=[],ledger=[]},today=dateJST()){
 const projects=new Map(),activity=[];
 const project=id=>{if(!projects.has(id))projects.set(id,{id,articles:0,social:0,mock:false,metrics:[]});return projects.get(id);};
 const research=new Map(records.filter(r=>r.sourceUrl&&r.status==='acquired'&&r.verification==='source_observed').map(r=>[r.sourceUrl,r]));
 for(const r of research.values())if(r.fetchedAt)activity.push({date:dateJST(new Date(r.fetchedAt)),kind:'research'});
 const articleMap=new Map(),firstArticleDates=new Map();
 for(const d of drafts){if(d.department!=='content'||!d.document?.projectId)continue;const id=d.document.projectId,old=articleMap.get(id);const date=draftDate(d);if(date&&(!firstArticleDates.has(id)||date<firstArticleDates.get(id)))firstArticleDates.set(id,date);if(!old||(d.localRevision||0)>(old.localRevision||0))articleMap.set(id,d);}
 for(const [id,d] of articleMap){const p=project(id);p.articles=1;p.title=d.topic;p.research=new Set([...String(d.evidence||'').matchAll(/^出典：(https:\/\/\S+)$/gm)].map(x=>x[1])).size;p.mock=d.generation?.provider==='preview-mock';const date=firstArticleDates.get(id);if(date)activity.push({date:date.slice(0,10),kind:'article'});}
 const socialMap=new Map(),firstSocialDates=new Map();for(const s of social)if(s.projectId){socialMap.set(s.projectId,s);if(s.createdAt&&(!firstSocialDates.has(s.projectId)||s.createdAt<firstSocialDates.get(s.projectId)))firstSocialDates.set(s.projectId,s.createdAt);}
 for(const [id,s] of socialMap){const p=project(id);p.social=Number(!!s.x)+Number(!!s.instagram);p.title ||= s.title;p.mock ||= !!s.mock;if(firstSocialDates.has(id))activity.push({date:dateJST(new Date(firstSocialDates.get(id))),kind:'social',count:p.social});}
 const uniqueMetrics=new Map();for(const m of metrics)uniqueMetrics.set(m.projectId+'|'+m.date,m);
 for(const m of uniqueMetrics.values())project(m.projectId).metrics.push(m);
 const uniqueLedger=[...new Map(ledger.map((r,i)=>[r.id||'legacy-'+i,r])).values()];
 for(const l of uniqueLedger)if(l.projectId)project(l.projectId);
 for(const l of uniqueLedger)if(!Number.isFinite(Number(l.amount))||Number(l.amount)<0||!['revenue','expense','api'].includes(l.type))throw Error('旧台帳に集計できない値があります。元データを確認してください');
 const finance=(month,projectId)=>{const rows=uniqueLedger.filter(r=>(!month||r.date?.startsWith(month))&&(!projectId||r.projectId===projectId));if(!rows.length)return {revenue:null,cost:null,profit:null,count:0};const income=rows.filter(r=>r.type==='revenue'),expenses=rows.filter(r=>r.type!=='revenue'),revenue=income.length?income.reduce((n,r)=>n+Math.round(Number(r.amount)*100),0)/100:null,cost=expenses.length?expenses.reduce((n,r)=>n+Math.round(Number(r.amount)*100),0)/100:null;return {revenue,cost,profit:revenue===null||cost===null?null:Math.round((revenue-cost)*100)/100,count:rows.length};};
 return {research:research.size,manualResearch:records.filter(r=>r.status!=='acquired'||r.verification!=='source_observed').length,articles:articleMap.size,social:[...socialMap.values()].reduce((n,s)=>n+Number(!!s.x)+Number(!!s.instagram),0),mockSocial:[...socialMap.values()].filter(s=>s.mock).reduce((n,s)=>n+Number(!!s.x)+Number(!!s.instagram),0),mockArticles:[...articleMap.values()].filter(d=>d.generation?.provider==='preview-mock').length,projects:[...projects.values()],activity,month:finance(today.slice(0,7)),total:finance(),finance,metrics:[...uniqueMetrics.values()],today};
}
