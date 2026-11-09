export async function onRequestPost({ request, env }) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };
  try {
    if (!env.JARVIS_ACCESS_PASSWORD || !env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "Cloudflareの環境変数が未設定です" }), { status: 500, headers });
    }
    if (request.headers.get("x-jarvis-password") !== env.JARVIS_ACCESS_PASSWORD) {
      return new Response(JSON.stringify({ error: "パスワードが違います" }), { status: 401, headers });
    }
    const body = await request.json();
    const prompt = String(body.prompt || "").trim();
    if (!prompt || prompt.length > 6000) {
      return new Response(JSON.stringify({ error: "指示は1〜6000文字で入力してください" }), { status: 400, headers });
    }

    // 既存の通常チャットと動画制作指令は従来どおりの応答形式を維持する
    if (body.mode === "secretary") {
      const today = new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric", weekday: "long"
      }).format(new Date());
      const history = Array.isArray(body.history) ? body.history.slice(-8).map(item => ({
        role: item.role === "assistant" ? "assistant" : "user",
        content: String(item.content || "").slice(0, 2000)
      })).filter(item => item.content) : [];
      const system = `あなたはユーザー専属AI秘書J.A.R.V.I.S.です。今日は日本時間の${today}です。
ユーザーの発言を次のいずれかに分類し、会話の流れも踏まえて自然に対応してください。
calendar=予定・予約・勤務・外出など日時のある出来事
task=やるべき作業・ToDo
reminder=指定時刻に思い出させる依頼
memory=今後も覚えておく情報・好み・方針
conversation=雑談・質問・相談
clarification=分類や内容を決めるために確認が必要

重要ルール:
- 雑談を勝手に予定・タスク・メモとして保存しない。ユーザーが保存・登録・覚えて・リマインド等を明確に求めた場合だけ保存候補にする。
- 「来週車検」など情報が不足する場合は、勝手に日付や時刻を決めず、必要なことを1つずつ質問する。返答を受けたら直前の会話と合わせて完成させる。
- 予定は日付・開始時刻・終了時刻・予定名が揃っている場合だけready_to_save=trueにする。終日予定と判断できる場合はstart_time="09:00", end_time="10:00"のように勝手に仮時刻を入れず、時刻を質問する。
- taskはタイトルが明確なら保存候補にできる。期限が不明でも期限なしタスクとして保存できる。
- reminderは通知する日時が明確でない限り保存候補にせず、日時を質問する。
- memoryはユーザーが「覚えて」「今後は」「好みは」など、今後のために保持する意図を示した場合だけ保存候補にする。
- ready_to_save=trueでも、実際の保存はユーザーが画面上の保存ボタンを押すまで行わない。
- conversationは普通の会話として自然に答える。保存ボタンを出さない。
- 回答は日本語で簡潔に。確認質問は一度に一つだけ。
- 日付はYYYY-MM-DD、時刻は24時間HH:mm。分からない値は空文字。
- 予定やタスク等を保存することと、Googleカレンダーへ登録することは別。Googleカレンダー登録は画面上の確認操作後に行う。`;
      const schema = {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["calendar", "task", "reminder", "memory", "conversation", "clarification"] },
          reply: { type: "string" },
          ready_to_save: { type: "boolean" },
          title: { type: "string" },
          detail: { type: "string" },
          date: { type: "string" },
          start_time: { type: "string" },
          end_time: { type: "string" },
          due_at: { type: "string" }
        },
        required: ["kind", "reply", "ready_to_save", "title", "detail", "date", "start_time", "end_time", "due_at"],
        additionalProperties: false
      };
      const messages = [...history, { role: "user", content: prompt }];
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1200,
          system,
          messages,
          output_config: { format: { type: "json_schema", schema } }
        })
      });
      const result = await response.json();
      if (!response.ok) {
        return new Response(JSON.stringify({ error: "Claude APIエラー", detail: result.error?.message || "応答を取得できませんでした" }), { status: 502, headers });
      }
      const raw = (result.content || []).filter(item => item.type === "text").map(item => item.text).join("");
      let secretary;
      try { secretary = JSON.parse(raw); }
      catch { return new Response(JSON.stringify({ error: "AIの判定結果を読み取れませんでした。もう一度お試しください。" }), { status: 502, headers }); }
      return new Response(JSON.stringify({ secretary }), { status: 200, headers });
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }]
      })
    });
    const result = await response.json();
    if (!response.ok) {
      return new Response(JSON.stringify({ error: "Claude APIエラー", detail: result.error?.message || "応答を取得できませんでした" }), { status: 502, headers });
    }
    const answer = (result.content || []).filter(item => item.type === "text").map(item => item.text).join("\n");
    return new Response(JSON.stringify({ answer }), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: "通信に失敗しました。設定を確認してください。" }), { status: 500, headers });
  }
}
