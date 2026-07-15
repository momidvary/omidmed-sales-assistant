import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { allowedCostBehaviors, allowedExpenseCategories } from "@/lib/accounting/constants";

export const runtime = "nodejs";

const allowedKinds = new Set(["expense", "partner_withdrawal", "review", "ignore"]);
const allowedReviewKinds = new Set(["asset_purchase", "installment", "ambiguous"]);

type IncomingRow = {
  sourceAccount?: string;
  documentNumber?: string;
  jalaliDate?: string;
  gregorianDate?: string;
  debit?: number;
  credit?: number;
  description?: string;
  normalizedDescription?: string;
  partnerName?: string | null;
  kind?: string;
  category?: string;
  costBehavior?: string;
  reviewKind?: string;
};

function clean(value: unknown, max = 1000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

function externalKey(ownerId: string, row: IncomingRow) {
  return createHash("sha256")
    .update([
      ownerId,
      clean(row.sourceAccount, 120),
      clean(row.documentNumber, 80),
      clean(row.gregorianDate, 20),
      String(Math.round(Number(row.debit ?? 0))),
      String(Math.round(Number(row.credit ?? 0))),
      clean(row.normalizedDescription || row.description, 1000),
    ].join("|"))
    .digest("hex");
}

function chunks<T>(items: T[], size: number) {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const fileName = clean(body.fileName, 240);
    const fileChecksum = clean(body.fileChecksum, 128);
    const unit = body.unit === "rial" ? "rial" : "toman";
    const rows = Array.isArray(body.rows) ? (body.rows as IncomingRow[]) : [];

    if (!fileName || !fileChecksum || !rows.length || rows.length > 5000) {
      return NextResponse.json({ error: "فایل یا ردیف‌های ارسالی معتبر نیستند." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return NextResponse.json({ error: "ابتدا دوباره وارد برنامه شو." }, { status: 401 });
    }
    const ownerId = authData.user.id;
    const multiplier = unit === "rial" ? 0.1 : 1;

    const sanitized = rows.map((row) => {
      const kind = allowedKinds.has(clean(row.kind, 30)) ? clean(row.kind, 30) : "review";
      const date = clean(row.gregorianDate, 20);
      const rawAmount = Math.max(Number(row.debit ?? 0), Number(row.credit ?? 0));
      const amount = Math.max(0, Math.round(rawAmount * multiplier));
      return {
        row,
        kind,
        date,
        amount,
        key: externalKey(ownerId, row),
      };
    }).filter((item) => validDate(item.date) && item.amount > 0);

    if (!sanitized.length) {
      return NextResponse.json({ error: "هیچ ردیف معتبر برای ثبت باقی نماند." }, { status: 400 });
    }

    const totals = {
      expense: sanitized.filter((item) => item.kind === "expense").length,
      partner: sanitized.filter((item) => item.kind === "partner_withdrawal").length,
      review: sanitized.filter((item) => item.kind === "review").length,
      ignored: sanitized.filter((item) => item.kind === "ignore").length,
    };

    const { data: batch, error: batchError } = await supabase
      .from("accounting_import_batches")
      .upsert({
        owner_id: ownerId,
        source: "holo_fp3",
        file_name: fileName,
        file_checksum: fileChecksum,
        row_count: sanitized.length,
        expense_count: totals.expense,
        partner_withdrawal_count: totals.partner,
        review_count: totals.review,
        ignored_count: totals.ignored,
        status: "processing",
        imported_at: new Date().toISOString(),
      }, { onConflict: "owner_id,file_checksum" })
      .select("id")
      .single();

    if (batchError || !batch) {
      return NextResponse.json({ error: batchError?.message || "ساخت سابقه ورود فایل انجام نشد." }, { status: 500 });
    }

    const expenses = sanitized.filter((item) => item.kind === "expense").map(({ row, date, amount, key }) => {
      const category = clean(row.category, 30);
      const costBehavior = clean(row.costBehavior, 20);
      return {
        owner_id: ownerId,
        expense_date: date,
        category: allowedExpenseCategories.has(category) ? category : "other",
        cost_behavior: allowedCostBehaviors.has(costBehavior) ? costBehavior : "mixed",
        amount,
        payee: null,
        payment_method: "cash",
        description: clean(row.description, 1200) || null,
        is_recurring: false,
        source: "holo_fp3",
        external_key: key,
        source_document_number: clean(row.documentNumber, 80) || null,
        raw_description: clean(row.description, 2000) || null,
        import_batch_id: batch.id,
      };
    });

    const partnerWithdrawals = sanitized.filter((item) => item.kind === "partner_withdrawal").map(({ row, date, amount, key }) => ({
      owner_id: ownerId,
      withdrawal_date: date,
      partner_name: clean(row.partnerName, 120) || "نامشخص",
      amount,
      payment_method: "cash",
      document_number: clean(row.documentNumber, 80) || null,
      description: clean(row.description, 1200) || null,
      source: "holo_fp3",
      external_key: key,
      import_batch_id: batch.id,
    }));

    const reviewItems = sanitized.filter((item) => item.kind === "review").map(({ row, date, amount, key }) => {
      const reviewKind = clean(row.reviewKind, 30);
      return {
        owner_id: ownerId,
        entry_date: date,
        review_kind: allowedReviewKinds.has(reviewKind) ? reviewKind : "ambiguous",
        amount,
        document_number: clean(row.documentNumber, 80) || null,
        source_account: clean(row.sourceAccount, 120) || null,
        raw_description: clean(row.description, 2000),
        suggested_category: allowedExpenseCategories.has(clean(row.category, 30)) ? clean(row.category, 30) : "other",
        status: "pending",
        source: "holo_fp3",
        external_key: key,
        import_batch_id: batch.id,
      };
    });

    let expensesInserted = 0;
    let partnerWithdrawalsInserted = 0;
    let reviewItemsInserted = 0;

    for (const part of chunks(expenses, 200)) {
      const { data, error } = await supabase.from("workshop_expenses").upsert(part, {
        onConflict: "owner_id,source,external_key",
        ignoreDuplicates: true,
      }).select("id");
      if (error) throw error;
      expensesInserted += data?.length ?? 0;
    }

    for (const part of chunks(partnerWithdrawals, 200)) {
      const { data, error } = await supabase.from("partner_withdrawals").upsert(part, {
        onConflict: "owner_id,source,external_key",
        ignoreDuplicates: true,
      }).select("id");
      if (error) throw error;
      partnerWithdrawalsInserted += data?.length ?? 0;
    }

    for (const part of chunks(reviewItems, 200)) {
      const { data, error } = await supabase.from("accounting_review_items").upsert(part, {
        onConflict: "owner_id,source,external_key",
        ignoreDuplicates: true,
      }).select("id");
      if (error) throw error;
      reviewItemsInserted += data?.length ?? 0;
    }

    const inserted = expensesInserted + partnerWithdrawalsInserted + reviewItemsInserted;
    const duplicates = Math.max(0, sanitized.length - totals.ignored - inserted);

    await supabase.from("accounting_import_batches").update({
      status: "completed",
      inserted_count: inserted,
      duplicate_count: duplicates,
      completed_at: new Date().toISOString(),
    }).eq("id", batch.id);

    return NextResponse.json({
      expensesInserted,
      partnerWithdrawalsInserted,
      reviewItemsInserted,
      ignored: totals.ignored,
      duplicates,
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "خطای ناشناخته در ورود فایل";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
