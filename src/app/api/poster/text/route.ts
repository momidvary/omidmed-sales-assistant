import { NextResponse } from "next/server";

import { AiConfigError, resolveAiConfig } from "@/lib/ai/config";
import { generatePosterText, MAX_DESCRIPTION_LENGTH, PosterTextError } from "@/lib/poster/text";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return NextResponse.json({ error: "ابتدا وارد برنامه شو." }, { status: 401 });
  }

  let description = "";
  try {
    const body = (await request.json()) as { description?: unknown };
    description = String(body.description ?? "").trim();
  } catch {
    return NextResponse.json({ error: "اطلاعات درخواست معتبر نیست." }, { status: 400 });
  }

  if (!description) {
    return NextResponse.json({ error: "اول چند جمله درباره محصول بنویس." }, { status: 400 });
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return NextResponse.json(
      { error: `توضیحات حداکثر ${MAX_DESCRIPTION_LENGTH} کاراکتر می‌تواند باشد.` },
      { status: 400 },
    );
  }

  try {
    const { apiKey, model } = resolveAiConfig("content");
    const text = await generatePosterText({ apiKey, model, description });
    return NextResponse.json({ text });
  } catch (error) {
    if (error instanceof AiConfigError) {
      return NextResponse.json({ error: error.userMessage }, { status: 503 });
    }
    if (error instanceof PosterTextError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    console.error("Poster text generation failed");
    return NextResponse.json({ error: "تولید متن انجام نشد. دوباره تلاش کن." }, { status: 500 });
  }
}
