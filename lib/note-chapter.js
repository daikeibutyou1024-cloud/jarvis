import {ContinuationError,validatedContinuation,headings} from './continuation.js';
function sectionRange(previous,title){
 const clean=previous.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g,b=>b.replace(/[^\n]/g,' '));
 const all=[...clean.matchAll(/^(#{1,6})[ \t]+(.+?)[ \t]*$/gm)];
 const found=all.filter(m=>m[1].length===2&&m[2]===title);
 if(found.length>1)throw new ContinuationError('対象章の重複');
 const m=found[0];if(!m)return null;
 const next=all.find(n=>n.index>m.index&&n[1].length<=2);
 return {start:m.index,bodyStart:m.index+m[0].length,end:next?.index??previous.length};
}
export function noteChapterPlan(previous,title,continuation=false){
 const target=sectionRange(previous,title);
 if(continuation&&!target)throw new ContinuationError('続きの対象章がありません');
 if(!continuation&&target&&previous.slice(target.bodyStart,target.end).trim())throw new ContinuationError('既存の章は続きを作成するか手動編集してください');
 return target;
}
export function composeNoteChapter(previous,candidate,options){
 const continuing=options.mode==='continue',target=noteChapterPlan(previous,options.section,continuing);
 let part=candidate.trim();
 if(!continuing){
  const first=part.match(/^##\s+(.+?)\s*\n/);
  if(first?.[1]===options.section)part=part.slice(first[0].length);
 }
 if(headings(part).some(h=>h.level<=2))throw new ContinuationError('章以外の構成の再生成');
 const checked=validatedContinuation(previous,part,options,{localHeadingLevel:2});
 const base=previous.trim()?previous:`# ${(options.title||"記事タイトル").replace(/[\r\n]+/g," ")}\n`;
 const body=target?previous.slice(0,target.end).trimEnd()+'\n'+checked.text+'\n\n'+previous.slice(target.end):base.trimEnd()+`\n\n## ${options.section}\n`+checked.text;
 return {body,validation:checked.validation};
}
