// 営業名刺帳 — 名刺写真の読み取り（Supabase Edge Function「read-card」）
//
// ブラウザから名刺画像（base64）を受け取り、Claude API で文字を読み取って JSON で返します。
// - Anthropic の API キーは Supabase の Secrets「ANTHROPIC_API_KEY」に保存し、ブラウザには出しません。
// - 公開キーだけでは呼べないよう、ログイン中の社員かどうかをこの関数の中で確認します。

import Anthropic from "npm:@anthropic-ai/sdk@0.125.0";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const FIELDS = ["company", "department", "title", "name", "kana", "phone", "mobile", "email", "fax", "address", "url"] as const;

const RECORD_TOOL: Anthropic.Beta.BetaTool = {
  name: "record_business_card",
  description: "名刺から読み取った項目を記録する。読み取れない・記載のない項目は空文字にする。",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      company: { type: "string", description: "会社名（株式会社などの法人格を含む正式名称）" },
      department: { type: "string", description: "部署" },
      title: { type: "string", description: "役職" },
      name: { type: "string", description: "氏名。姓と名の間に半角スペースを1つ入れる" },
      kana: { type: "string", description: "ふりがな（ひらがな）。名刺にふりがなが無ければ空文字" },
      phone: { type: "string", description: "代表または直通の固定電話" },
      mobile: { type: "string", description: "携帯電話（090/080/070 など）" },
      email: { type: "string", description: "メールアドレス" },
      fax: { type: "string", description: "FAX番号" },
      address: { type: "string", description: "住所（郵便番号があれば含める）" },
      url: { type: "string", description: "WebサイトのURL" },
    },
    required: [...FIELDS],
    additionalProperties: false,
  },
};

const PROMPT = `この画像は日本のビジネス名刺の写真です。印字されている内容を読み取り、record_business_card ツールで記録してください。
- 印字されている文字だけを使い、推測で補わないでください。読み取れない項目・記載のない項目は空文字にします。
- ロゴの中の文字やキャッチコピーは会社名に含めません。
- 英語表記しか無い項目は、印字どおりに入れてください。`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // ログイン中の社員かを確認する（公開キーだけの呼び出しは断る）
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) return json({ error: "unauthorized" }, 401);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "not_configured" }, 500);

  let image = "";
  let mediaType: "image/jpeg" | "image/png" = "image/jpeg";
  try {
    const body = await req.json();
    image = typeof body.image === "string" ? body.image : "";
    if (body.mediaType === "image/png") mediaType = "image/png";
  } catch {
    return json({ error: "image_rejected" }, 400);
  }
  // 画面側で長辺1600pxに縮小して送るので、通常は1MB未満。大きすぎるものは断る
  if (!image || image.length > 7_000_000) return json({ error: "image_rejected" }, 400);

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      tools: [RECORD_TOOL],
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") return json({ error: "refused" }, 422);

    const block = response.content.find(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === RECORD_TOOL.name,
    );
    if (!block) return json({ error: "invalid_output" }, 422);

    const input = block.input as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const key of FIELDS) result[key] = typeof input[key] === "string" ? (input[key] as string) : "";
    return json(result);
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return json({ error: "rate_limited" }, 429);
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      console.error("Anthropic API キーが無効です", error.message);
      return json({ error: "not_configured" }, 500);
    }
    if (error instanceof Anthropic.BadRequestError) {
      console.error("リクエストが不正です", error.message);
      return json({ error: "image_rejected" }, 400);
    }
    if (error instanceof Anthropic.APIError) {
      console.error(`Anthropic API エラー ${error.status}`, error.message);
      return json({ error: "upstream_error" }, 502);
    }
    console.error("読み取り中の予期しないエラー", error);
    return json({ error: "upstream_error" }, 502);
  }
});
