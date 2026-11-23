import {naturalJapanese} from './speech-style.js';
// Transform only the spoken copy; the original chat text remains unchanged.
export function spokenText(text) {
  return naturalJapanese(String(text)
    .replace(/^【Previewモック】\s*/u, '')
    .replace(/\s*（動作確認用の回答です。実AIは使用していません。）\s*$/u, '')
    .replace(/https?:\/\/\S+/g, 'リンク')
    .replace(/[0-9#*]\uFE0F?\u20E3/gu, '')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji_Modifier}\uFE0F\u200D\u20E3\u{E0020}-\u{E007F}]/gu, '')
    .replace(/[#*_~`>]/g, '')
    .replace(/[ \t]+/g, ' ').trim()).replace(/\s+/g,' ').trim();
}
