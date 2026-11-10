import {articleBody,inspectPaid,paidSections,sourcesFromEvidence,PAID_FORMAT} from './paid-content.js';
import {canApprove,unknownGeneration,generationOptions} from './generation.js';
export class EditorialError extends Error {}
export const NOTE_FORMATS=['note記事','note無料記事',PAID_FORMAT];
export const REVIEW_CHECKS=['facts','usefulness','rights','privacy','advertising'];
export function defaultOutline(format){return format===PAID_FORMAT?[...paidSections]:['読者の悩み','解決方法','実践手順','まとめ'];}
export function workflowInput(value,format){
 if(!NOTE_FORMATS.includes(format))throw new EditorialError('記事制作フローはnote記事が対象です');
 if(!value||typeof value!=='object'||Array.isArray(value))throw new EditorialError('制作条件が不正です');
 if(typeof value.idea!=='string'||value.idea.length>1500)throw new EditorialError('企画メモは1500文字以内です');
 const outline=value.outline;
 if(!Array.isArray(outline)||outline.length<2||outline.length>20||outline.some(x=>typeof x!=='string'||!x.trim()||x.length>120||/[\r\n#]/.test(x)))throw new EditorialError('構成は重複のない章名を2〜20件指定してください');
 const titles=outline.map(x=>x.trim());
 if(new Set(titles).size!==titles.length)throw new EditorialError('章名が重複しています');
 if(format===PAID_FORMAT&&JSON.stringify(titles)!==JSON.stringify(paidSections))throw new EditorialError('有料記事では無料部分・有料部分・必須成果物の構成を使用してください');
 return {version:1,idea:value.idea.trim(),outline:titles,noExternalFacts:value.noExternalFacts===true};
}
export function compactGeneration(g){
 if(!g)return unknownGeneration();
 const {provider,model,stopReason,completionStatus,articleStatus,usage,mode,section,format,document,operationId,cost}=g;
 return {provider,model,stopReason,completionStatus,articleStatus,usage,mode,section,format,document,operationId,cost,
  ...(g.project?{project:{brief:g.project.brief,sections:g.project.sections?.map(s=>({title:s.title,generationState:s.generationState}))}}:{})};
}
function sectionContents(text){
 const plain=text.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g,b=>b.replace(/[^\n]/g,' '));
 const matches=[...plain.matchAll(/^(#{1,6})[ \t]+(.+?)[ \t]*$/gm)];
 return matches.map((m,i)=>{const next=matches.slice(i+1).find(x=>x[1].length<=m[1].length);return {start:m.index,title:m[2],level:m[1].length,body:text.slice(m.index+m[0].length,next?.index??text.length).trim()};});
}
export function editorialReport(doc){
 const missing=[],body=articleBody(doc.output||''),format=doc.format||doc.generation?.format;
 let workflow;
 try{workflow=workflowInput(doc.workflow,format);}catch(e){missing.push(e.message);workflow={idea:'',outline:defaultOutline(format),noExternalFacts:false};}
 if(!doc.topic?.trim())missing.push('テーマがありません');
 if(!doc.audience?.trim())missing.push('対象読者がありません');
 if(!workflow.idea)missing.push('採用する企画メモがありません');
 const evidence=doc.evidence||'',sources=sourcesFromEvidence(evidence);
 if(!sources.length&&!workflow.noExternalFacts)missing.push('確認済みの根拠資料、または外部事実を使用しない方針が必要です');
 for(const source of sources){
  if(!/^https:\/\//.test(source.url)||!source.review.includes('利用者確認日時：'))missing.push(`資料 ${source.id} の出典・利用者確認が不足しています`);
 }
 const sections=sectionContents(body);
 if(sections.filter(s=>s.level===1).length!==1)missing.push("記事タイトルの見出しを一つ作成してください");
 const paidCheck=format===PAID_FORMAT?inspectPaid(doc.output||"",evidence):null;
 const chapters=workflow.outline.map(title=>{
  const found=sections.filter(s=>s.title===title);
  let status=found.length>1?'duplicate':found.length===1&&found[0].body?'present':'missing';
  const artifact={"実践手順":"procedure","記入済みサンプル（架空の例）":"sample","完成テンプレート":"template"}[title];
  if(status==='present'&&artifact&&paidCheck&&!paidCheck.artifacts[artifact])status='needs_work';
  if(status==='missing')missing.push(`未作成または空の章：${title}`);
  if(status==='duplicate')missing.push(`重複した章：${title}`);
  return {title,status};
 });
 if(!body.trim())missing.push('本文がありません');
 if(format===PAID_FORMAT)missing.push(...paidCheck.missing);
 else{
  const ids=[...body.matchAll(/\[(R\d+)\]/g)].map(m=>m[1]);
  for(const id of ids)if(!sources.some(s=>s.id===id))missing.push(`存在しない出典番号：${id}`);
  if(sources.length&&!ids.some(id=>sources.some(s=>s.id===id)))missing.push('本文に根拠資料のR番号がありません');
  for(const url of body.match(/https?:\/\/[^\s<>\])「」]+/g)||[])if(!sources.some(s=>s.url===url))missing.push(`未登録URL：${url}`);
 }
 // Provider end_turn and the old local confirmation are never editorial approval.
 let transportComplete=false;try{transportComplete=canApprove(doc.generation);}catch{}
 if(!transportComplete)missing.push('本文の生成終了または手動補完完了が未確認です');
 const positions=workflow.outline.map(t=>sections.findIndex(s=>s.title===t)).filter(i=>i>=0);
 if(positions.some((n,i)=>i>0&&n<positions[i-1]))missing.push("本文の章順が予定する構成と異なります");
 const deficiencies=[...new Set(missing)];
 return {stage:!body.trim()?'planning':deficiencies.length?'drafting':'review_pending',readyForReview:deficiencies.length===0,missing:deficiencies,chapters,characters:body.length,sourceCount:sources.length,notice:'機械検査は形式の不足確認です。正確性・実用性・販売価値は人間の全文確認が必要です'};
}
export function storedGenerationOptions(value,doc){
 if(!doc||doc.department!=='content'||!NOTE_FORMATS.includes(doc.format))throw new EditorialError('保存済みのnote制作案件を選択してください');
 if(!['chapter','continue'].includes(value?.mode))throw new EditorialError('保存原稿の再開は章・続き生成のみです');
 const body=articleBody(doc.output||'');
 if(body.length>60000)throw new EditorialError('保存本文は60000文字以内です');
 const options=generationOptions({...value,previous:body.slice(-30000),format:doc.format,title:doc.topic,evidence:doc.evidence||'',audience:doc.audience||'',notes:doc.notes||''});
 return {...options,previous:body};
}
export function exportArticle(doc){
 const body=articleBody(doc.output||'').trim();
 const sources=sourcesFromEvidence(doc.evidence||'');
 const appendix=sources.length?'\n\n## 参考資料\n'+sources.map(s=>`- [${s.id}] ${s.title}\n  ${s.url}`).join('\n'):'';
 let freeMarkdown=body,paidMarkdown='';
 if(doc.format===PAID_FORMAT){
  const split=sectionContents(body).find(s=>s.level===2&&s.title==="有料部分")?.start;
  if(split===undefined)throw new EditorialError("有料部分の境界を確認してください");
  freeMarkdown=body.slice(0,split).trim();paidMarkdown=body.slice(split).trim()+appendix;
 }else freeMarkdown+=appendix;
 return {markdown:body+appendix,freeMarkdown,paidMarkdown,notice:'原稿ファイルの出力のみです。noteへの投稿・販売・価格設定は行いません'};
}
