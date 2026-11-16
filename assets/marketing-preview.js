import {socialDrafts} from '../lib/marketing-preview.js';
const KEY='jarvis_social_drafts_v1';
export function initMarketingPreview({getArticle,say}){
 const $=id=>document.getElementById(id);let current=null,dirty=false;
 function render(){
  $('marketing-project').textContent=current?`案件ID：${current.projectId} ／ ${current.mock?'Previewモック由来・要編集':'下書き・要確認'}`:'CONTENTから記事を引き渡してください';
  $('marketing-x').value=current?.x||'';$('marketing-instagram').value=current?.instagram||'';$('marketing-url').value=current?.articleURL||'';
 }
 function saved(){const rows=JSON.parse(localStorage.getItem(KEY)||'[]');if(!Array.isArray(rows))throw Error('保存データの形式を確認してください');return rows;}
 function list(){
  const root=$('marketing-saved');root.replaceChildren();
  for(const row of saved().slice().reverse()){
   const button=document.createElement('button');button.textContent=`${row.title} / ${row.projectId} / ${row.savedAt}`;
   button.onclick=()=>{if(dirty&&!confirm('未保存の投稿案があります。保存版を開きますか？'))return;current=structuredClone(row);dirty=false;render();};root.append(button);
  }
 }
 const api={accept(article){if(dirty&&!confirm('編集中の投稿案を置き換えますか？'))return false;current=socialDrafts(article);dirty=true;render();return true;}};
 $('marketing-make').onclick=()=>{try{const article=getArticle();if(!article)throw Error('CONTENTで記事を作成するか保存記事を開いてください');api.accept(article);}catch(e){say(e.message);}};
 for(const id of ['marketing-x','marketing-instagram','marketing-url'])$(id).oninput=()=>{dirty=true;};
 $('marketing-update-url').onclick=()=>{try{if(!current)throw Error('先に投稿案を作成してください');if(dirty&&!confirm('URLを反映して投稿案を再作成します。編集内容を置き換えますか？'))return;current=socialDrafts(current,$('marketing-url').value.trim());dirty=true;render();}catch(e){say(e.message);}};
 $('marketing-save').onclick=async()=>{try{
  if(!current)throw Error('先に投稿案を作成してください');
  const x=$('marketing-x').value,instagram=$('marketing-instagram').value;
  const articleURL=socialDrafts(current,$('marketing-url').value.trim()).articleURL;
  if(!x.trim()||!instagram.trim()||x.length>2000||instagram.length>5000)throw Error('Xは2000文字、Instagramは5000文字以内の下書きにしてください。投稿可能な文字数は投稿先で確認してください');
  if(!navigator.locks?.request)throw Error('安全な端末保存に非対応です。投稿案をコピーしてください');
  await navigator.locks.request(KEY,async()=>{const rows=saved();rows.push({...current,articleURL,x,instagram,savedAt:new Date().toISOString(),id:crypto.randomUUID()});localStorage.setItem(KEY,JSON.stringify(rows));});dirty=false;list();say('同じ案件IDで投稿案の新しい版を端末保存しました。投稿はしていません');
 }catch(e){say(e.message);}};
 for(const [id,target] of [['marketing-copy-x','marketing-x'],['marketing-copy-instagram','marketing-instagram']])$(id).onclick=async()=>{try{if(!$(target).value.trim())throw Error('投稿案が空です');await navigator.clipboard.writeText($(target).value);say('投稿案をコピーしました。自動投稿は行いません');}catch{ $(target).focus();$(target).select();say('コピーできませんでした。選択した文章を手動でコピーしてください');}};
 try{list();}catch(e){say(e.message);}render();return api;
}
