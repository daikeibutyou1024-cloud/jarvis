import {generationOptions,normalizeResult,composeResult} from './generation.js';
export function previewArticle(input){
 const o=generationOptions(input);
 if(o.mode!=='full'||!['note記事','note無料記事'].includes(o.format))throw Error('モックはnote無料記事・記事全体の生成だけに対応します');
 const packet=o.evidence;
 if(!packet.startsWith('【RESEARCH ')||packet.length>3500)throw Error('RESEARCHの確認済み資料を引き渡してください');
 const parts=packet.split(/(?=\[R\d+\] )/).slice(1);
 if(!parts.length||parts.length>5)throw Error('資料は1〜5件必要です');
 const sources=parts.map(part=>{
  const id=part.match(/^\[(R\d+)\]/)?.[1],title=part.split('\n')[0].replace(/^\[R\d+\] /,''),url=part.match(/^出典：(https:\/\/\S+)$/m)?.[1];
  if(!url||!part.match(/利用者確認日時：(?!未確認|未取得)[0-9]{4}-/))throw Error('出典と利用者確認がある資料だけ利用できます');
  const u=new URL(url);if(u.username||u.password)throw Error('出典URLが不正です');
  const summary=part.match(/^RSS要約・資料メモ：(.*)$/m)?.[1]||'概要は未取得です';
  const published=part.match(/^公開日時：(.*)$/m)?.[1]||'未取得',fetched=part.match(/^取得日時：([^\n]*?)(?: \/ 記録日時：|$)/m)?.[1]||'未取得';
  return {id,title,url,summary,published,fetched};
 });
 if(new Set(sources.map(s=>s.id)).size!==sources.length)throw Error('資料番号が重複しています');
 const title=(o.title||'公開情報から始めるAI活用').replace(/[\r\n]/g,' ');
 const text=`# ${title}\n\n【Previewモック下書き】実AIは使用していません。以下は選択資料を並べた編集用テンプレートです。公開前に本人が加筆・確認してください。\n\n## はじめに\nAIを使ってみたい初心者に向けて、今回選択した公開情報を整理します。実際の操作・効果・収益は検証していません。\n\n## 公式資料で分かること\n${sources.map(s=>`### ${s.title}\n配信元の抜粋：${s.summary}\n参照：[${s.id}](${s.url})`).join('\n\n')}\n\n## 初心者が試す手順\n1. 下記の公式出典を開き、公開日・対応環境・利用条件を確認します。\n2. 自分の目的に関係する機能を一つ選びます。\n3. 費用と安全性を確認してから試し、実施した操作だけを記事に追記します。\n\n## 注意点\n資料の抜粋だけでは全文・効果・料金を確認できません。RC版を含む場合があります。未実施の体験談や副業収益を創作しないでください。\n\n## まとめ\nまず公式情報を確認し、小さく試す計画を作りましょう。この記事は人間の確認・編集前の下書きです。\n\n## 出典\n${sources.map(s=>`- [${s.id}] ${s.title}：${s.url}（公開：${s.published}／取得：${s.fetched}）`).join('\n')}\n\n## 公開前の確認\n- 事実・公開日時・用語・手順を確認\n- 体験と資料の説明を区別\n- 出典と引用範囲を確認\n- 誇大な効果や収益の断定がないか確認`;
 const result=normalizeResult({content:[{type:'text',text}],stop_reason:'end_turn',usage:{input_tokens:0,output_tokens:0}},'anthropic','preview-template');
 result.generation.provider='preview-mock';result.generation.realCostUSD=0;
 const composed=composeResult(result,o);
 return {answer:composed.body,generation:{...composed.generation,provider:'preview-mock',model:'preview-template',realCostUSD:0},mock:true};
}
