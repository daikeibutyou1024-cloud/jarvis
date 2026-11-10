// Web Locks serializes writers across tabs; immutable local revisions preserve old drafts.
export async function saveLocalDraft(storage, locks, key, entry, expectedRevision) {
 if(!locks?.request)throw Error('このブラウザは安全な端末保存に対応していません。クラウド保存または原稿コピーを利用してください');
 return locks.request('jarvis:'+key,()=>{
  const rows=JSON.parse(storage.getItem(key)||'[]');
  if(!Array.isArray(rows))throw Error('保存データを読み取れません。上書きを停止しました');
  const current=rows.filter(d=>d.document?.projectId===entry.document.projectId).reduce((n,d)=>Math.max(n,d.localRevision||0),0);
  if(current!==expectedRevision)throw Error('別タブで端末保存されています。原稿をコピーしてから最新版を開いてください');
  const saved={...entry,localRevision:current+1};
  const next=[saved,...rows]; // Never silently evict legacy data or revision history.
  storage.setItem(key,JSON.stringify(next));
  return {rows:next,revision:saved.localRevision};
 });
}
