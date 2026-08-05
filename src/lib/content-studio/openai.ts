type OpenAIResponse = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  error?: { message?: string };
};

export class ContentGenerationError extends Error {
  constructor(
    message: string,
    readonly code: "CONFIG" | "PROVIDER" | "EMPTY" | "INVALID",
  ) {
    super(message);
    this.name = "ContentGenerationError";
  }
}

export function extractResponseText(data: OpenAIResponse) {
  if (data.output_text?.trim()) return data.output_text.trim();
  return (data.output ?? [])
    .flatMap((item) => (item.type === "message" ? item.content ?? [] : []))
    .filter((part) => part.type === "output_text" && part.text)
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export async function generateStructuredContent(input: {
  apiKey?: string;
  model: string;
  prompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}) {
  if (!input.apiKey?.trim()) {
    throw new ContentGenerationError("تنظیمات OpenAI کامل نیست.", "CONFIG");
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        reasoning: { effort: "low" },
        instructions:
          "You are Omidmed's careful Persian B2B content strategist. Follow the JSON schema exactly.",
        input: input.prompt,
        text: {
          format: {
            type: "json_schema",
            name: input.schemaName,
            strict: true,
            schema: input.schema,
          },
        },
        max_output_tokens: 1800,
        store: false,
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? 55_000),
      cache: "no-store",
    });
  } catch {
    throw new ContentGenerationError(
      "ارتباط با سرویس تولید محتوا برقرار نشد؛ دوباره تلاش کنید.",
      "PROVIDER",
    );
  }

  const data = (await response.json().catch(() => ({}))) as OpenAIResponse;
  if (!response.ok) {
    throw new ContentGenerationError(
      "سرویس تولید محتوا درخواست را نپذیرفت؛ تنظیمات و ورودی را بررسی کنید.",
      "PROVIDER",
    );
  }
  const text = extractResponseText(data);
  if (!text) {
    throw new ContentGenerationError("پاسخ مدل خالی بود؛ دوباره تلاش کنید.", "EMPTY");
  }
  return text;
}
