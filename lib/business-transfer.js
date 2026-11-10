import {BusinessError,normalizeRecord,fingerprint,id} from './business-records.js';
function limit(rows){if(!Array.isArray(rows)||!rows.length||rows.length>1000)throw new BusinessError('コピーは1〜1000件の範囲です');return rows;}
export async function legacyBusinessRows(ledger,metrics){
 if(!Array.isArray(ledger)||!metrics||typeof metrics!=='object'||Array.isArray(metrics))throw new BusinessError('端末の旧データを読み取れません');
 const rows=[],occurrences=new Map();
 for(const old of ledger){
  if(!old||typeof old!=='object')throw new BusinessError('旧収支データに不正な行があります');
  const base={kind:'finance',projectId:'',date:old.date,type:old.type,amount:old.amount,memo:old.memo||''};await normalizeRecord(base);
  const key=JSON.stringify(base),occurrence=(occurrences.get(key)||0)+1;occurrences.set(key,occurrence);
  const externalId=typeof old.id==='string'&&old.id?old.id:'no-id-'+(await fingerprint(key+'/'+occurrence)).slice(0,48);
  rows.push({...base,externalId});
 }
 for(const [month,m] of Object.entries(metrics)){
  if(!m||typeof m!=='object'||(m.period&&m.period!==month))throw new BusinessError('旧月次データの対象月が一致しません');
  const row={kind:'metrics',projectId:'',period:month,channel:'unspecified',visits:m.visits,clicks:m.clicks,conversions:m.conversions};await normalizeRecord(row);rows.push(row);
 }
 if(!rows.length)return [];
 limit(rows);
 const keys=rows.map(r=>r.kind==='finance'?'finance:'+r.externalId:'metric:'+r.period);if(new Set(keys).size!==keys.length)throw new BusinessError('元の記録IDが重複しています。コピーを停止しました');
 return rows;
}
export function csvCells(input){
 if(typeof input!=='string'||new TextEncoder().encode(input).length>1000000)throw new BusinessError('CSVは1MB以下です');
 const text=input.replace(/^\uFEFF/,''),rows=[];let row=[],cell='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(quoted){quoted=false;closed=true;}else{if(cell||closed)throw new BusinessError('CSVの引用符が不正です');quoted=true;}}
  else if(c===','&&!quoted){row.push(cell);cell='';closed=false;}
  else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';closed=false;}
  else{if(closed)throw new BusinessError('CSVの閉じた引用符の後に文字があります');cell+=c;}
 }
 if(quoted)throw new BusinessError('CSVの引用符が閉じていません');row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
 if(rows.length<2||rows.length>1001)throw new BusinessError('CSVはヘッダーと1〜1000件の記録が必要です');
 return rows;
}
export async function businessCsvRows(value,kind){
 const lines=csvCells(value),headers=lines.shift().map(x=>x.trim()),allowed=kind==='finance'?['id','date','type','amount','memo','projectId']:kind==='metrics'?['period','channel','visits','clicks','conversions','projectId']:null;
 if(!allowed||headers.length!==allowed.length||new Set(headers).size!==headers.length||headers.some(x=>!allowed.includes(x)))throw new BusinessError('指定したCSV形式の列名を確認してください');
 const rows=[];
 for(const cells of lines){if(cells.length!==headers.length)throw new BusinessError('CSVの列数が一致しません');const r={kind,...Object.fromEntries(headers.map((h,i)=>[h,cells[i]]))};if(kind==='finance')id(r.id);if(kind==='metrics')for(const key of ['visits','clicks','conversions']){if(!/^\d+$/.test(r[key]))throw new BusinessError('未入力の計測値を0へ補完しません');r[key]=Number(r[key]);}await normalizeRecord(r);rows.push(r);}
 const ids=await Promise.all(rows.map(async r=>(await normalizeRecord(r)).id));if(new Set(ids).size!==ids.length)throw new BusinessError('CSVに同じ記録IDまたは同じ対象月・案件・計測元が重複しています');
 return rows;
}
export async function copiedBusinessRows(value){
 let data;try{data=JSON.parse(value);}catch{throw new BusinessError('コピー用JSONを読み取れません');}
 if(data?.schema!=='jarvis-business-copy-v1')throw new BusinessError('対応する台帳コピー形式ではありません');limit(data.records);
 const rows=[];
 for(const record of data.records){if(typeof record.id!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(record.id))throw new BusinessError('コピー元の安定した記録IDが必要です');const p=record.payload;if(!p||!['finance','metrics'].includes(p.kind)||!['active','void'].includes(record.state))throw new BusinessError('収支・計測以外の記録はこのコピーで復元しません');const r={...p,id:record.id,state:record.state};if(p.kind==='finance'){if(!Number.isSafeInteger(p.amountMinor))throw new BusinessError('保存金額が不正です');r.amount=(p.amountMinor/100).toFixed(2);}await normalizeRecord(r);rows.push(r);}
 if(new Set(rows.map(r=>r.id)).size!==rows.length)throw new BusinessError("コピー用JSONの記録IDが重複しています");
 return rows;
}
export function safeCsv(rows,headers){return '\uFEFF'+[headers,...rows.map(row=>headers.map(h=>row[h]??''))].map(row=>row.map(v=>{let s=String(v);if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(',')).join('\r\n');}
