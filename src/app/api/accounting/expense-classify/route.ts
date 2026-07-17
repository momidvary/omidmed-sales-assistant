import { NextResponse } from "next/server";

import {
  allowedCostScopes,
  deterministicExpenseClassification,
  normalizeExpenseText,
  type ExpenseClassification,
} from "@/lib/accounting/expense-classification";
import { groupExpenseRows } from "@/lib/accounting/expense-groups";
import { allowedCostBehaviors, allowedExpenseCategories } from "@/lib/accounting/constants";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "key",
          "category",
          "cost_behavior",
          "cost_scope",
          "manufacturing_share_percent",
          "confidence",
          "reason",
        ],
        properties: {
          key: { type: "string" },
          category: {
            type: "string",
            enum: [
              "rent",
              "utilities",
              "direct_labor",
              "indirect_labor",
              "sewing",
              "printing",
              "packaging",
              "shipping",
              "maintenance",
              "advertising",
              "equipment",
              "tax_fee",
              "insurance",
              "software",
              "other",
            ],
          },
          cost_behavior: { type: "string", enum: ["fixed", "variable", "mixed"] },
          cost_scope: {
            type: "string",
            enum: ["manufacturing", "selling", "period", "asset", "partner", "ignore"],
          },
          manufacturing_share_percent: { type: "number" },
          confidence: { type: "number" },
          reason: { type: "string" },
        },
      },
    },
  },
} as const;

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  error?: { message?: string };
};

function outputText(data: OpenAIResponse) {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const parts: string[] = [];
  for (const item of data.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function sanitizeSuggestion(value: Partial<ExpenseClassification>, fallback: ExpenseClassification) {
  const category = String(value.category ?? fallback.category);
  const costBehavior = String(value.costBehavior ?? fallback.costBehavior);
  const costScope = String(value.costScope ?? fallback.costScope);
  const share = Number(value.manufacturingSharePercent ?? fallback.manufacturingSharePercent);
  const confidence = Number(value.confidence ?? fallback.confidence);
  return {
    key: normalizeExpenseText(value.key ?? fallback.key),
    category: allowedExpenseCategories.has(category) ? category : fallback.category,
    costBehavior: allowedCostBehaviors.has(costBehavior) ? costBehavior : fallback.costBehavior,
    costScope: allowedCostScopes.has(costScope) ? costScope : fallback.costScope,
    manufacturingSharePercent: Math.min(100, Math.max(0, Number.isFinite(share) ? share : 0)),
    confidence: Math.min(1, Math.max(0, Number.isFinite(confidence) ? confidence : 0)),
    reason: String(value.reason ?? fallback.reason).trim().slice(0, 600),
  } satisfies ExpenseClassification;
}

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return NextResponse.json({ error: "ابتدا دوباره وارد برنامه شو." }, { status: 401 });
    }

    const [expenseResult, reviewResult, rulesResult] = await Promise.all([
      supabase
        .from("workshop_expenses")
        .select("id,amount,expense_date,category,cost_behavior,raw_description,description,classification_status")
        .order("expense_date", { ascending: false })
        .limit(5000),
      supabase
        .from("accounting_review_items")
        .select("id,amount,entry_date,raw_description,source_account,review_kind,suggested_category,status")
        .eq("status", "pending")
        .order("entry_date", { ascending: false })
        .limit(3000),
      supabase
        .from("expense_classification_rules")
        .select("match_text,match_mode,category,cost_behavior,cost_scope,manufacturing_share_percent,confidence,reason")
        .eq("is_active", true)
        .limit(1000),
    ]);

    const databaseError = expenseResult.error || reviewResult.error || rulesResult.error;
    if (databaseError) {
      return NextResponse.json(
        { error: `خواندن هزینه‌ها انجام نشد. ابتدا SQL شماره ۰۰۹ را اجرا کن. ${databaseError.message}` },
        { status: 500 },
      );
    }

    const expenseRows = (expenseResult.data ?? []).map((row) => ({ ...row }));
    const reviewRows = (reviewResult.data ?? []).map((row) => ({
      ...row,
      category: row.suggested_category || "other",
      cost_behavior: "mixed",
      classification_status: "pending",
    }));
    const groups = groupExpenseRows(expenseRows, reviewRows).slice(0, 120);
    const rules = rulesResult.data ?? [];

    const fallbacks = new Map<string, ExpenseClassification>();
    for (const group of groups) {
      const savedRule = rules.find((rule) => {
        const ruleText = normalizeExpenseText(rule.match_text);
        if (!ruleText) return false;
        return rule.match_mode === "exact"
          ? group.key === ruleText
          : group.key.includes(ruleText) || ruleText.includes(group.key);
      });
      const fallback = savedRule
        ? sanitizeSuggestion(
            {
              key: group.key,
              category: savedRule.category,
              costBehavior: savedRule.cost_behavior,
              costScope: savedRule.cost_scope,
              manufacturingSharePercent: Number(savedRule.manufacturing_share_percent ?? 0),
              confidence: Number(savedRule.confidence ?? 1),
              reason: savedRule.reason || "این تصمیم قبلاً توسط شما ذخیره شده است.",
            },
            deterministicExpenseClassification(group.label, group.currentCategory),
          )
        : deterministicExpenseClassification(group.label, group.currentCategory);
      fallbacks.set(group.key, fallback);
    }

    const apiKey = process.env.OPENAI_API_KEY;
    let model: string | null = null;
    let usedAi = false;
    let suggestions = [...fallbacks.values()];
    let warning: string | null = null;

    const groupsNeedingAi = groups
      .filter((group) => {
        const fallback = fallbacks.get(group.key);
        return fallback && fallback.confidence < 0.9 && !rules.some((rule) => normalizeExpenseText(rule.match_text) === group.key);
      })
      .slice(0, 80);

    if (apiKey && groupsNeedingAi.length) {
      model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
      const payload = groupsNeedingAi.map((group) => ({
        key: group.key,
        description: group.label,
        count: group.count,
        total_amount_toman: Math.round(group.totalAmount),
        current_category: group.currentCategory,
        source_accounts: group.sourceAccounts,
        review_kinds: group.reviewKinds,
        rule_based_suggestion: fallbacks.get(group.key),
      }));

      const prompt = `هزینه‌های زیر مربوط به کارگاه تولید لوازم مصرفی فیزیوتراپی امیدمِد است. برای هر گروه فقط طبقه‌بندی مدیریتی پیشنهاد بده.

زمینه کسب‌وکار:
- تولید پد فیزیوتراپی، ملحفه، کیف چاپ‌دار و استرپ
- چاپ سیلک شامل رنگ، ریتاردر، حلال، کلیشه، شابلون و خرابی دستگاه است
- دوخت، زیپ‌کیپ، برش و بسته‌بندی هزینه تولید هستند
- پست، باربری، اسنپ ارسال و تبلیغات هزینه فروش و توزیع هستند
- خرید دستگاه و تجهیزات دارایی است و نباید یک‌جا وارد قیمت محصول شود
- برداشت شرکا هزینه نیست
- مالیات، اقساط و شرح‌های مبهم را محافظه‌کارانه طبقه‌بندی کن

تعریف cost_scope:
- manufacturing: هزینه‌ای که باید تمام یا بخشی از آن در بهای محصول باشد
- selling: هزینه فروش، ارسال و توزیع که در قیمت نهایی لحاظ می‌شود ولی سربار تولید نیست
- period: هزینه عمومی دوره که فعلاً مستقیم روی محصول تقسیم نمی‌شود
- asset: خرید دستگاه یا دارایی
- partner: برداشت شریک
- ignore: مورد نامرتبط یا تکراری

قواعد:
1. key را دقیقاً بدون تغییر برگردان.
2. manufacturing_share_percent فقط برای manufacturing بین صفر تا صد باشد؛ برای سایر scopeها صفر.
3. اگر مطمئن نیستی confidence را پایین بگذار و دلیل کوتاه فارسی بنویس.
4. مبلغ یا دسته جدید اختراع نکن.

داده‌ها:
${JSON.stringify(payload)}`;

      try {
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            reasoning: { effort: "low" },
            input: [{ role: "user", content: prompt }],
            text: {
              format: {
                type: "json_schema",
                name: "expense_classification",
                strict: true,
                schema: outputSchema,
              },
            },
            max_output_tokens: 5000,
            store: false,
          }),
          signal: AbortSignal.timeout(55_000),
          cache: "no-store",
        });
        const data = (await response.json()) as OpenAIResponse;
        if (response.ok) {
          const text = outputText(data);
          const parsed = JSON.parse(text) as {
            items?: Array<{
              key?: string;
              category?: string;
              cost_behavior?: string;
              cost_scope?: string;
              manufacturing_share_percent?: number;
              confidence?: number;
              reason?: string;
            }>;
          };
          const aiMap = new Map(
            (parsed.items ?? []).map((item) => [
              normalizeExpenseText(item.key),
              {
                key: normalizeExpenseText(item.key),
                category: item.category,
                costBehavior: item.cost_behavior,
                costScope: item.cost_scope,
                manufacturingSharePercent: item.manufacturing_share_percent,
                confidence: item.confidence,
                reason: item.reason,
              },
            ]),
          );
          suggestions = groups.map((group) => {
            const fallback = fallbacks.get(group.key)!;
            const ai = aiMap.get(group.key);
            return ai ? sanitizeSuggestion(ai, fallback) : fallback;
          });
          usedAi = true;
        } else {
          warning = "هوش مصنوعی پاسخ نداد؛ پیشنهادهای مطمئن داخلی برنامه نمایش داده شده‌اند.";
        }
      } catch (error) {
        console.error("Expense classification AI fallback:", error);
        warning = "تحلیل هوش مصنوعی کامل نشد؛ پیشنهادهای داخلی برنامه قابل استفاده‌اند.";
      }
    } else if (!apiKey) {
      warning = "کلید OpenAI تنظیم نشده؛ پیشنهادهای داخلی برنامه نمایش داده شده‌اند.";
    }

    const suggestionMap = new Map(suggestions.map((item) => [item.key, item]));
    return NextResponse.json({
      groups: groups.map((group) => ({
        ...group,
        suggestion: suggestionMap.get(group.key) ?? fallbacks.get(group.key),
      })),
      usedAi,
      model,
      warning,
      summary: {
        groupCount: groups.length,
        expenseCount: expenseRows.length,
        pendingReviewCount: reviewRows.length,
        totalAmount: groups.reduce((sum, group) => sum + group.totalAmount, 0),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "خطای ناشناخته";
    console.error("Expense classification route error:", message);
    return NextResponse.json({ error: "تحلیل هزینه‌ها انجام نشد. دوباره تلاش کن." }, { status: 500 });
  }
}
