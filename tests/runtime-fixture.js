import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export const budgetEnv={AI_MONTHLY_BUDGET_USD:'100',AI_PRICING_JSON:JSON.stringify({'anthropic/claude-sonnet-4-6':{input:3,output:15},'openai/gpt-4.1-mini':{input:0.4,output:1.6}})};
export function adaptDB(db){return {
 db,raw:db,
 prepare(sql){return {args:[],bind(...args){this.args=args;return this;},_run(){return {meta:{changes:Number(db.prepare(sql).run(...this.args).changes)}};},async run(){return this._run();},async first(){return db.prepare(sql).get(...this.args)||null;},async all(){return {results:db.prepare(sql).all(...this.args)};}};},
 async batch(ss){db.exec('BEGIN IMMEDIATE');try{const rows=ss.map(s=>s._run());db.exec('COMMIT');return rows;}catch(e){db.exec('ROLLBACK');throw e;}},
};}
export function testDB(){const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../migrations/0001_business_jobs.sql',import.meta.url),'utf8'));return adaptDB(db);}
