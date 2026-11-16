import {previewArticle} from './content-preview.js';
import {researchPacket} from '../assets/research-data.js';
import {socialDrafts} from './marketing-preview.js';
export const QUICK_KEY='jarvis_quick_drafts_v1';
export function latestPacks(rows){if(!Array.isArray(rows))throw Error('保存形式が不正です。上書きしません');const map=new Map();for(const p of rows){const old=map.get(p.projectId);if(!old||p.revision>old.revision)map.set(p.projectId,p);}return [...map.values()];}
export function createPack(data,projectId,now=new Date().toISOString()){
 if(data?.status!=='acquired'||!Array.isArray(data.items)||!data.items.length)throw Error(data?.error||'公式情報を取得できませんでした。再作成ボタンで再試行してください');
 const r=data.items[0];
 if(r.origin!=='ollama'||r.status!=='acquired'||typeof r.title!=='string'||typeof r.text!=='string'||!r.sourceUrl?.startsWith('https://github.com/ollama/ollama/releases/tag/')||!Number.isFinite(Date.parse(r.publishedAt))||!Number.isFinite(Date.parse(r.fetchedAt)))throw Error('出典・日時を確認できません。取得し直してください');
 const source={...r,reviewedAt:null},evidence=researchPacket([source]);
 const title='初心者向け：'+r.title;
 const article=previewArticle({mode:'full',format:'note無料記事',title,evidence},{allowUnreviewed:true});
 const social=socialDrafts({projectId,title,article:article.answer,evidence,mock:true});
 return {projectId,title,revision:1,createdAt:now,savedAt:now,source,article:article.answer,x:social.x,instagram:social.instagram,evidence,generation:article.generation,mock:true,approvedAt:null};
}
export async function savePack(storage,locks,pack,expectedRevision){
 if(!locks?.request)throw Error('安全な端末保存に非対応です。表示内容をコピーして退避してください');
 return locks.request(QUICK_KEY,()=>{const rows=JSON.parse(storage.getItem(QUICK_KEY)||'[]'),old=latestPacks(rows).find(x=>x.projectId===pack.projectId);if((old?.revision||0)!==expectedRevision)throw Error('別タブで更新されています。編集内容をコピーしてから保存一覧を開き直してください');const next={...pack,revision:expectedRevision+1,savedAt:new Date().toISOString()};storage.setItem(QUICK_KEY,JSON.stringify([...rows,next]));return next;});
}
