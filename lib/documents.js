export const DOCUMENT_SCHEMA = [
 `CREATE TABLE IF NOT EXISTS document_revisions (project_id TEXT NOT NULL, revision INTEGER NOT NULL, write_id TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(project_id,revision))`,
];
export class SaveConflict extends Error {
 constructor(currentRevision) { super('別の保存が先に完了しました。現在の原稿を端末保存し、最新版を読み直してください'); this.code='SAVE_CONFLICT'; this.status=409; this.currentRevision=currentRevision; }
}
export async function initDocuments(db) { for(const sql of DOCUMENT_SCHEMA) await db.prepare(sql).run(); }
export function projectId(value) {
 if (value !== undefined && value !== null && (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value))) throw Error('案件IDが不正です');
 return value || crypto.randomUUID();
}
export async function revisionOf(db,id) {
 await initDocuments(db);
 const r=await db.prepare('SELECT COALESCE(MAX(revision),0) AS revision FROM document_revisions WHERE project_id=?').bind(id).first();
 return r.revision;
}
export async function seedLegacyPaid(db,id) {
 await initDocuments(db);
 const exists=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='paid_content_drafts'").first();
 if(!exists)return;
 const old=await db.prepare("SELECT * FROM paid_content_drafts WHERE id=?").bind(id).first();
 if(!old)return;
 await db.prepare("INSERT OR IGNORE INTO document_revisions(project_id,revision,write_id,payload) SELECT ?,0,?,? WHERE NOT EXISTS(SELECT 1 FROM document_revisions WHERE project_id=?)")
  .bind(id,crypto.randomUUID(),JSON.stringify({department:"content",topic:old.topic,output:old.output,format:"note有料記事",generation:JSON.parse(old.generation_json),legacy:true}),id).run();
}
export async function checkRevision(db,id,expected) {
 await seedLegacyPaid(db,id);
 const current=await revisionOf(db,id);
 if (!Number.isSafeInteger(expected) || expected<0 || expected!==current) throw new SaveConflict(current);
 return current;
}
// Immutable revisions and legacy mirror commit together in D1's atomic batch.
export async function saveRevision(db,id,expected,payload,mirror = null, guard = null) {
 if(!Number.isSafeInteger(expected) || expected<0) throw new SaveConflict(await revisionOf(db,id));
 await initDocuments(db);
 const writeId=crypto.randomUUID(), revision=expected+1;
 const statements=[db.prepare(`INSERT INTO document_revisions(project_id,revision,write_id,payload)
 SELECT ?,?,?,? WHERE (SELECT COALESCE(MAX(revision),0) FROM document_revisions WHERE project_id=?)=? ${guard ? "AND ("+guard.sql+")" : ""}`)
 .bind(id,revision,writeId,JSON.stringify(payload),id,expected,...(guard?.args||[]))];
 if(mirror) statements.push(...[mirror(writeId)].flat());
 const results=await db.batch(statements);
 if(!results[0].meta?.changes) throw new SaveConflict(await revisionOf(db,id));
 return {projectId:id,revision};
}
export async function documentList(db) {
 await initDocuments(db);
 const rows=await db.prepare('SELECT * FROM document_revisions d WHERE revision=(SELECT MAX(revision) FROM document_revisions WHERE project_id=d.project_id) ORDER BY created_at DESC,rowid DESC LIMIT 20').all();
 return rows.results.map(r=>({...JSON.parse(r.payload),projectId:r.project_id,revision:r.revision,updated_at:r.created_at}));
}
export async function latestDocument(db,id){
 await seedLegacyPaid(db,id);
 const row=await db.prepare('SELECT * FROM document_revisions WHERE project_id=? ORDER BY revision DESC LIMIT 1').bind(id).first();
 return row?{...JSON.parse(row.payload),projectId:id,revision:row.revision}:null;
}
