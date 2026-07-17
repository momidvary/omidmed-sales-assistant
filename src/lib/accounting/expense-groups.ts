import { normalizeExpenseText } from "@/lib/accounting/expense-classification";

export type ExpenseSourceRow = {
  id: string;
  amount: number | string;
  expense_date?: string | null;
  entry_date?: string | null;
  category?: string | null;
  cost_behavior?: string | null;
  raw_description?: string | null;
  description?: string | null;
  source_account?: string | null;
  review_kind?: string | null;
  classification_status?: string | null;
};

export type ExpenseGroup = {
  key: string;
  label: string;
  count: number;
  totalAmount: number;
  latestDate: string | null;
  currentCategory: string;
  currentBehavior: string;
  sourceAccounts: string[];
  expenseIds: string[];
  reviewIds: string[];
  reviewKinds: string[];
  confirmedCount: number;
};

export function groupExpenseRows(
  expenseRows: ExpenseSourceRow[],
  reviewRows: ExpenseSourceRow[],
) {
  const groups = new Map<string, ExpenseGroup>();

  const add = (row: ExpenseSourceRow, source: "expense" | "review") => {
    const raw = row.raw_description || row.description || row.source_account || "شرح نامشخص";
    const key = normalizeExpenseText(raw) || `unknown-${row.id}`;
    const current = groups.get(key) ?? {
      key,
      label: String(raw).replace(/\s+/g, " ").trim().slice(0, 240),
      count: 0,
      totalAmount: 0,
      latestDate: null,
      currentCategory: row.category || "other",
      currentBehavior: row.cost_behavior || "mixed",
      sourceAccounts: [],
      expenseIds: [],
      reviewIds: [],
      reviewKinds: [],
      confirmedCount: 0,
    };

    current.count += 1;
    current.totalAmount += Number(row.amount ?? 0);
    const date = row.expense_date || row.entry_date || null;
    if (date && (!current.latestDate || date > current.latestDate)) current.latestDate = date;
    if (row.category && current.currentCategory === "other") current.currentCategory = row.category;
    if (row.cost_behavior && current.currentBehavior === "mixed") current.currentBehavior = row.cost_behavior;
    if (row.source_account && !current.sourceAccounts.includes(row.source_account)) {
      current.sourceAccounts.push(row.source_account);
    }
    if (source === "expense") current.expenseIds.push(row.id);
    else current.reviewIds.push(row.id);
    if (row.review_kind && !current.reviewKinds.includes(row.review_kind)) current.reviewKinds.push(row.review_kind);
    if (row.classification_status === "confirmed" || row.classification_status === "auto") current.confirmedCount += 1;
    groups.set(key, current);
  };

  expenseRows.forEach((row) => add(row, "expense"));
  reviewRows.forEach((row) => add(row, "review"));

  return [...groups.values()].sort((a, b) => {
    const aPending = a.confirmedCount < a.expenseIds.length ? 1 : 0;
    const bPending = b.confirmedCount < b.expenseIds.length ? 1 : 0;
    return bPending - aPending || b.totalAmount - a.totalAmount || b.count - a.count;
  });
}
