// Read-only manifest. No upload/import/delete path exists in this release.
import {latestPacks} from './quick-draft.js';
const normalize=p=>JSON.stringify({title:p.title,article:p.article,x:p.x,instagram:p.instagram,source:{url:p.source?.sourceUrl,publishedAt:p.source?.publishedAt,fetchedAt:p.source?.fetchedAt,title:p.source?.title,text:p.source?.text,origin:p.source?.origin},evidence:p.evidence,generation:{provider:p.generation?.provider,model:p.generation?.model},mock:p.mock===true});
async function fingerprint(p){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalize(p)))),n=>n.toString(16).padStart(2,'0')).join('');}
export async function migrationPlan(localRows,cloudRows){
 const local=latestPacks(localRows),cloud=latestPacks(cloudRows),entries=[];
 for(const p of local){const remote=cloud.find(r=>r.projectId===p.projectId),contentHash=await fingerprint(p),cloudHash=remote?await fingerprint(remote):null;entries.push({projectId:p.projectId,revision:p.revision,contentHash,cloudRevision:remote?.revision??null,cloudHash,status:!remote?'not-imported':p.revision===remote.revision&&contentHash===cloudHash?'same':'conflict',requiresReapproval:true});}
 return {localCount:local.length,cloudCount:cloud.length,entries,importEnabled:false,notice:'照合だけです。転送・上書き・承認の引継ぎは行いません。'};
}
