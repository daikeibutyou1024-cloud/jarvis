// Transform only the spoken copy; the original chat text remains unchanged.
export function spokenText(text) {
  return String(text)
    .replace(/https?:\/\/\S+/g, 'リンク')
    .replace(/[0-9#*]\uFE0F?\u20E3/gu, '')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji_Modifier}\uFE0F\u200D\u20E3\u{E0020}-\u{E007F}]/gu, '')
    .replace(/[#*_~`>]/g, '')
    .replace(/\s+/g, ' ').trim();
}
