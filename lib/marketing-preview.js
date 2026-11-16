// Deterministic local templates. No model, network, DB or publishing integrations.
export function socialDrafts({projectId,title,article,evidence='',mock=true},articleURL=''){
 if(typeof projectId!=='string'||!projectId||typeof article!=='string'||!article.trim())throw Error('CONTENTの記事を先に作成してください');
 if(articleURL){if(articleURL.length>400)throw Error('記事URLは400文字以内にしてください');const u=new URL(articleURL);if(u.protocol!=='https:'||u.username||u.password||u.hostname!=='note.com')throw Error('記事URLは公開後のhttps://note.com/のURLを入力してください');}
 const heading=String(title||article.split('\n')[0].replace(/^#+\s*/, '')).slice(0,60);
 const lead=article.split('\n').map(s=>s.trim()).find(s=>s&&!s.startsWith('#')&&!s.includes('Previewモック'))||'公式情報をもとにAI活用を整理しました。';
 const link=articleURL||'［公開後に記事URLを入力］';
 return {projectId,title:heading,article,evidence,mock,articleURL,x:`【投稿案・未公開${mock?'／モック記事由来':''}】\n${heading.slice(0,30)}\n初心者向けに公式情報と注意点を整理した下書きです。\n記事はこちら：${link}\n#AI活用 #初心者向け`,instagram:`【投稿案・未公開${mock?'／モック記事由来':''}】\n${heading}\n\n${lead.slice(0,240)}\n\nまずは公式情報を確認し、自分に合う使い方を考えてみませんか。\n詳しい記事：${link}\nInstagram本文のURLは通常タップできません。公開時はプロフィール等の導線を本人が設定してください。\n\n#AI活用 #生成AI #初心者向け #学び\n\n※内容・引用・必要なPR表記は投稿前に確認してください。`,createdAt:new Date().toISOString()};
}
