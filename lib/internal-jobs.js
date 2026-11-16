export const JOBS_KEY='jarvis_internal_jobs_v1';
export const JOB_STAGES=['research','content','marketing','analytics','finance','approval'];
export async function recordJob(storage,locks,id,patch){
 return locks.request(JOBS_KEY,()=>{const rows=JSON.parse(storage.getItem(JOBS_KEY)||'[]');if(!Array.isArray(rows))throw Error('ジョブ保存形式が不正です');const old=rows.find(x=>x.id===id)||{id,createdAt:new Date().toISOString(),attempt:0,stages:[]};const next={...old,...patch,updatedAt:new Date().toISOString()};storage.setItem(JOBS_KEY,JSON.stringify([...rows.filter(x=>x.id!==id),next]));return next;});
}
export function reviseMock(pack,instruction){
 if(typeof instruction!=='string'||!instruction.trim()||instruction.length>1000)throw Error('修正依頼は1〜1000文字で入力してください');
 const next=structuredClone(pack);next.approvedAt=null;next.source.reviewedAt=null;next.revisionRequests=[...(next.revisionRequests||[]),{instruction,at:new Date().toISOString(),mode:'mock'}];
 const title=instruction.match(/^タイトル[：:]\s*(.{1,100})$/m)?.[1],addition=instruction.match(/^追記[：:]\s*(.{1,500})$/m)?.[1];
 if(!title&&!addition){next.jobState='revision_requested';return next;}
 if(title){next.title=title;next.article=next.article.replace(/^# .+$/m,'# '+title);}
 if(addition)next.article+='\n\n## 本人から依頼された追記案（未確認）\n'+addition;
 next.jobState='awaiting_approval';return next;
}
