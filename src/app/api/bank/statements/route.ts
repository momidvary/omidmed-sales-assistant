import { NextResponse } from "next/server";

import { existingFingerprints, importStatement } from "@/lib/bank/import";
import { extractPdfItems, MAX_STATEMENT_PDF_BYTES } from "@/lib/bank/pdf-items";
import { parseResalatStatement, statementProblems } from "@/lib/bank/resalat-statement";
import { jalaliToGregorian } from "@/lib/jalali";
import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/team";

// Reads a Resalat statement PDF. mode=preview only parses and reports what
// would be imported; mode=import writes the new rows.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return NextResponse.json({ error: "ابتدا وارد برنامه شو." }, { status: 401 });
  }
  if (!(await isOwner())) {
    return NextResponse.json({ error: "این کار فقط با حساب مدیر انجام می‌شود." }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "فایل ارسال نشد." }, { status: 400 });
  }
  const file = form.get("file");
  const mode = form.get("mode") === "import" ? "import" : "preview";
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "فایل PDF صورت‌حساب را انتخاب کنید." }, { status: 400 });
  }
  if (file.size > MAX_STATEMENT_PDF_BYTES) {
    return NextResponse.json({ error: "حجم فایل بیشتر از ۵ مگابایت است." }, { status: 413 });
  }

  const data = new Uint8Array(await file.arrayBuffer());
  // "%PDF-": the file's own header, not the browser-reported type.
  if (data[0] !== 0x25 || data[1] !== 0x50 || data[2] !== 0x44 || data[3] !== 0x46 || data[4] !== 0x2d) {
    return NextResponse.json({ error: "این فایل PDF نیست." }, { status: 415 });
  }

  let statement;
  try {
    statement = parseResalatStatement(await extractPdfItems(data), jalaliToGregorian);
  } catch {
    return NextResponse.json(
      { error: "فایل خوانده نشد. صورت‌حساب را دوباره از همراه‌بانک رسالت به صورت PDF بگیرید." },
      { status: 422 },
    );
  }

  const problems = statementProblems(statement);
  if (problems.length) {
    return NextResponse.json(
      {
        error: "این فایل با اطمینان خوانده نشد و ثبت نمی‌شود.",
        problems,
      },
      { status: 422 },
    );
  }

  try {
    if (mode === "import") {
      const result = await importStatement(supabase, statement, file.name);
      return NextResponse.json({ success: true, ...result });
    }

    const known = await existingFingerprints(
      supabase,
      statement.transactions.map((tx) => tx.fingerprint),
    );
    return NextResponse.json({
      accountNo: statement.accountNo,
      fromDate: statement.fromDate,
      toDate: statement.toDate,
      totals: statement.totals,
      transactions: statement.transactions.map((tx) => ({
        fingerprint: tx.fingerprint,
        jalaliDate: tx.jalaliDate,
        time: tx.time,
        kind: tx.kind,
        amountRial: tx.kind === "deposit" ? tx.depositRial : tx.withdrawalRial,
        isFee: tx.isFee,
        counterpartyName: tx.counterpartyName,
        duplicate: known.has(tx.fingerprint),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "ثبت صورت‌حساب انجام نشد." },
      { status: 503 },
    );
  }
}
