import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import {
  allowedCostScopes,
  normalizeExpenseText,
} from "@/lib/accounting/expense-classification";
import { groupExpenseRows } from "@/lib/accounting/expense-groups";
import { allowedCostBehaviors, allowedExpenseCategories } from "@/lib/accounting/constants";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Decision = {
  key?: unknown;
  category?: unknown;
  costBehavior?: unknown;
  costScope?: unknown;
  manufacturingSharePercent?: unknown;
  confidence?: unknown;
  reason?: unknown;
};

function clean(value: unknown, max = 1000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function chunks<T>(items: T[], size: number) {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { decisions?: unknown };
    if (!Array.isArray(body.decisions) || !body.decisions.length || body.decisions.length > 200) {
      return NextResponse.json({ error: "فهرست تصمیم‌ها معتبر نیست." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return NextResponse.json({ error: "ابتدا دوباره وارد برنامه شو." }, { status: 401 });
    }
    const ownerId = authData.user.id;

    const decisions = (body.decisions as Decision[]).map((item) => {
      const key = normalizeExpenseText(item.key);
      const category = clean(item.category, 40);
      const costBehavior = clean(item.costBehavior, 30);
      const costScope = clean(item.costScope, 30);
      const share = Number(item.manufacturingSharePercent ?? 0);
      const confidence = Number(item.confidence ?? 1);
      return {
        key,
        category: allowedExpenseCategories.has(category) ? category : "other",
        costBehavior: allowedCostBehaviors.has(costBehavior) ? costBehavior : "mixed",
        costScope: allowedCostScopes.has(costScope) && costScope !== "unreviewed" ? costScope : "period",
        manufacturingSharePercent:
          costScope === "manufacturing" ? Math.min(100, Math.max(0, Number.isFinite(share) ? share : 0)) : 0,
        confidence: Math.min(1, Math.max(0, Number.isFinite(confidence) ? confidence : 1)),
        reason: clean(item.reason, 600),
      };
    }).filter((item) => item.key);

    if (!decisions.length) {
      return NextResponse.json({ error: "هیچ تصمیم قابل ثبت وجود ندارد." }, { status: 400 });
    }

    const [expenseResult, reviewResult] = await Promise.all([
      supabase
        .from("workshop_expenses")
        .select("id,amount,expense_date,category,cost_behavior,raw_description,description,classification_status")
        .limit(5000),
      supabase
        .from("accounting_review_items")
        .select("id,amount,entry_date,raw_description,source_account,review_kind,suggested_category,status,document_number,source,external_key,import_batch_id")
        .eq("status", "pending")
        .limit(3000),
    ]);
    const readError = expenseResult.error || reviewResult.error;
    if (readError) {
      return NextResponse.json({ error: `خواندن ردیف‌های هزینه انجام نشد: ${readError.message}` }, { status: 500 });
    }

    const reviewRows = (reviewResult.data ?? []).map((row) => ({
      ...row,
      category: row.suggested_category || "other",
      cost_behavior: "mixed",
      classification_status: "pending",
    }));
    const groups = groupExpenseRows(expenseResult.data ?? [], reviewRows);
    const groupMap = new Map(groups.map((group) => [group.key, group]));

    const rules = decisions.map((decision) => ({
      owner_id: ownerId,
      match_text: decision.key,
      match_mode: "contains",
      category: decision.category,
      cost_behavior: decision.costBehavior,
      cost_scope: decision.costScope,
      manufacturing_share_percent: decision.manufacturingSharePercent,
      confidence: decision.confidence,
      reason: decision.reason || null,
      source: "manual",
      is_active: true,
    }));
    const { error: rulesError } = await supabase.from("expense_classification_rules").upsert(rules, {
      onConflict: "owner_id,match_text",
    });
    if (rulesError) {
      return NextResponse.json({ error: `ذخیره قواعد انجام نشد: ${rulesError.message}` }, { status: 500 });
    }

    let expensesUpdated = 0;
    let reviewConverted = 0;
    let reviewResolved = 0;

    for (const decision of decisions) {
      const group = groupMap.get(decision.key);
      if (!group) continue;

      for (const part of chunks(group.expenseIds, 100)) {
        if (!part.length) continue;
        const { error } = await supabase
          .from("workshop_expenses")
          .update({
            category: decision.category,
            cost_behavior: decision.costBehavior,
            cost_scope: decision.costScope === "partner" ? "ignore" : decision.costScope,
            manufacturing_share_percent: decision.manufacturingSharePercent,
            classification_status: "confirmed",
            classification_source: "smart_review",
            classification_reason: decision.reason || null,
          })
          .in("id", part);
        if (error) throw error;
        expensesUpdated += part.length;
      }

      const matchingReviews = (reviewResult.data ?? []).filter((row) =>
        group.reviewIds.includes(row.id),
      );
      if (!matchingReviews.length) continue;

      if (["manufacturing", "selling", "period"].includes(decision.costScope)) {
        const newExpenses = matchingReviews.map((row) => ({
          owner_id: ownerId,
          expense_date: row.entry_date,
          category: decision.category,
          cost_behavior: decision.costBehavior,
          amount: Number(row.amount ?? 0),
          payee: row.source_account || null,
          payment_method: "cash",
          description: row.raw_description,
          is_recurring: false,
          source: "holo_fp3_review_resolved",
          external_key: row.external_key || row.id,
          source_document_number: row.document_number || null,
          raw_description: row.raw_description,
          import_batch_id: row.import_batch_id || null,
          cost_scope: decision.costScope,
          manufacturing_share_percent: decision.manufacturingSharePercent,
          classification_status: "confirmed",
          classification_source: "smart_review",
          classification_reason: decision.reason || null,
        }));
        const { data, error } = await supabase.from("workshop_expenses").upsert(newExpenses, {
          onConflict: "owner_id,source,external_key",
          ignoreDuplicates: true,
        }).select("id");
        if (error) throw error;
        reviewConverted += data?.length ?? 0;
      }

      const reviewStatus = decision.costScope === "ignore" ? "ignored" : "resolved";
      const { error: reviewUpdateError } = await supabase
        .from("accounting_review_items")
        .update({
          status: reviewStatus,
          suggested_category: decision.category,
          resolution_notes: `${decision.costScope}: ${decision.reason || "تأیید در مرتب‌سازی هوشمند هزینه‌ها"}`,
        })
        .in("id", group.reviewIds);
      if (reviewUpdateError) throw reviewUpdateError;
      reviewResolved += group.reviewIds.length;
    }

    // Keep category-level defaults as a fallback for manual expenses.
    const manufacturingByCategory = new Map<string, number[]>();
    for (const decision of decisions) {
      if (decision.costScope !== "manufacturing") continue;
      manufacturingByCategory.set(decision.category, [
        ...(manufacturingByCategory.get(decision.category) ?? []),
        decision.manufacturingSharePercent,
      ]);
    }
    const categoryRules = [...manufacturingByCategory.entries()].map(([category, values]) => ({
      owner_id: ownerId,
      category,
      include_in_product_cost: true,
      manufacturing_share_percent: values.reduce((sum, value) => sum + value, 0) / values.length,
      allocation_basis: "standard_minutes",
      notes: "به‌روزرسانی خودکار از مرتب‌سازی هوشمند هزینه‌ها",
    }));
    if (categoryRules.length) {
      const { error } = await supabase.from("expense_costing_rules").upsert(categoryRules, {
        onConflict: "owner_id,category",
      });
      if (error) throw error;
    }

    revalidatePath("/accounting/pricing/cost-review");
    revalidatePath("/accounting/pricing/setup");
    revalidatePath("/accounting/pricing");
    revalidatePath("/accounting/expenses");

    return NextResponse.json({
      savedRules: rules.length,
      expensesUpdated,
      reviewConverted,
      reviewResolved,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "خطای ناشناخته";
    console.error("Apply expense classifications error:", message);
    return NextResponse.json({ error: "ثبت تصمیم‌های هزینه انجام نشد. دوباره تلاش کن." }, { status: 500 });
  }
}
