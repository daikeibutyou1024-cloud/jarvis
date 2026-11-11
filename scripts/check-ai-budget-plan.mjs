import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {aiConfig} from '../lib/ai-runtime.js';
import {usdMicro} from '../lib/ai-money.js';
export function inspectBudgetPlan(plan){
 if(plan?.schema!=='jarvis-preview-budget-plan-v1')throw Error('予算計画の形式が不正です');
 const pricing=JSON.stringify({[plan.provider+'/'+plan.model]:plan.pricePerMillionTokens});
 const fixture={AI_PROVIDER:plan.provider,ANTHROPIC_MODEL:plan.model,OPENAI_MODEL:plan.model,AI_PRICING_JSON:pricing,AI_MONTHLY_BUDGET_USD:'1',AI_OPENING_SPEND_USD_JSON:'{}',ANTHROPIC_API_KEY:'offline-placeholder',OPENAI_API_KEY:'offline-placeholder'};
 // Configuration arithmetic only. aiConfig has no network or database access.
 const check=aiConfig(fixture,'導入準備の計算のみ',4000),missing=[];
 if(plan.approvedMonthlyBudgetUSD===null||plan.approvedMonthlyBudgetUSD===undefined)missing.push('利用者が承認する月額上限USD');else usdMicro(plan.approvedMonthlyBudgetUSD);
 if(plan.verifiedOpeningSpendUSD===null||plan.verifiedOpeningSpendUSD===undefined)missing.push('今月の導入前利用額USD（請求履歴で確認）');else usdMicro(plan.verifiedOpeningSpendUSD);
 const result={result:missing.length?'decisions_required':'prepared_not_applied',missing,pricingFormatValid:true,simulatedReservationUSD:(check.reserve/1e6).toFixed(6),variables:null,applied:false,realAPICalls:0,notice:'設定計算のみ。秘密・環境変数・DBを変更せず、AI APIを呼びません。料金の最新確認とプロバイダー側上限、既存D1利用台帳との照合も必要です'};
 if(!missing.length){const amount=usdMicro(plan.approvedMonthlyBudgetUSD),opening=usdMicro(plan.verifiedOpeningSpendUSD);result.variables={AI_PROVIDER:plan.provider,...(plan.provider==='anthropic'?{ANTHROPIC_MODEL:plan.model}:{OPENAI_MODEL:plan.model}),AI_MONTHLY_BUDGET_USD:plan.approvedMonthlyBudgetUSD,AI_PRICING_JSON:pricing,AI_OPENING_SPEND_USD_JSON:JSON.stringify({[new Date().toISOString().slice(0,7)]:plan.verifiedOpeningSpendUSD})};result.sampleRequestBlockedByBudget=amount===0||amount<opening+check.reserve;}
 return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const result=inspectBudgetPlan(JSON.parse(await readFile(process.argv[2]||new URL('../config/preview-ai-budget.plan.json',import.meta.url),'utf8')));console.log(JSON.stringify(result,null,2));if(result.result==='decisions_required')process.exitCode=2;}
 catch{console.error(JSON.stringify({result:'blocked',error:'予算計画の形式・金額・モデル料金を確認してください。秘密や実APIは利用していません'}));process.exitCode=2;}
}
