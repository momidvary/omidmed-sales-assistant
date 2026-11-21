import { isServiceLine } from "@/lib/products/service-lines";
import { normalizeSearchText } from "@/lib/search/normalize";

export type ItemPurchase = {
  date: string;
  product: string;
  quantity: number;
  articleCode?: string | null;
  invoiceId?: string;
};

export type ReorderUnit = {
  label: string;
  leadDays?: number;
  reorderAt?: number;
  stockCounts?: { date: string; quantity: number }[];
  parts: { quantity: number; keys: string[] }[];
};

function isQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isStockDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isReorderUnit(value: unknown): value is ReorderUnit {
  if (!value || typeof value !== "object") return false;
  const unit = value as ReorderUnit;
  if (typeof unit.label !== "string" || !unit.label.trim() || unit.label.length > 120 ||
      !Array.isArray(unit.parts) || !unit.parts.length || unit.parts.length > 30) return false;
  if (unit.leadDays !== undefined && (!Number.isInteger(unit.leadDays) || unit.leadDays < 0 || unit.leadDays > 365)) return false;
  if (unit.reorderAt !== undefined && !isQuantity(unit.reorderAt)) return false;
  if (unit.stockCounts !== undefined) {
    if (!Array.isArray(unit.stockCounts)) return false;
    const dates = new Set<string>();
    for (const count of unit.stockCounts) {
      if (!count || !isQuantity(count.quantity) || !isStockDate(count.date) || dates.has(count.date)) return false;
      dates.add(count.date);
    }
  }
  const seen = new Set<string>();
  for (const part of unit.parts) {
    if (!part || !Number.isFinite(part.quantity) || part.quantity <= 0 ||
        !Array.isArray(part.keys) || !part.keys.length || part.keys.length > 100) return false;
    for (const key of part.keys) {
      if (typeof key !== "string" || !/^(sku|name):.+$/u.test(key) || key.length > 512 || seen.has(key)) return false;
      seen.add(key);
    }
  }
  return true;
}

export function identifyProducts(items: ItemPurchase[]) {
  // Resolve older, uncoded lines only when the same name identifies one SKU.
  const codes = new Map<string, Set<string>>();
  const goods = items.filter(item => item.quantity > 0 && item.product.trim() && !isServiceLine(item.product));
  for (const item of goods) {
    const name = normalizeSearchText(item.product);
    const code = item.articleCode?.trim();
    if (!code) continue;
    const known = codes.get(name) ?? new Set<string>();
    known.add(code);
    codes.set(name, known);
  }
  return goods.map(item => {
    const nameKey = "name:" + normalizeSearchText(item.product);
    const known = codes.get(nameKey.slice(5));
    const code = item.articleCode?.trim() || (known?.size === 1 ? [...known][0] : null);
    return { ...item, key: code ? "sku:" + code : nameKey, legacyKey: (known?.size ?? 0) <= 1 ? nameKey : null };
  });
}

/** Count units supplied by complete orders. A separate component order does not restart a pack cycle. */
export function unitOrders(items: ReturnType<typeof identifyProducts>, unit: ReorderUnit) {
  const parts = new Map(unit.parts.flatMap((part, index) => part.keys.map(key => [key, index] as const)));
  const invoices = new Map<string, { date: string; counts: number[] }>();
  for (const item of items) {
    const index = parts.get(item.key) ?? (item.legacyKey ? parts.get(item.legacyKey) : undefined);
    if (index === undefined) continue;
    const id = item.invoiceId ?? item.date;
    const order = invoices.get(id) ?? { date: item.date, counts: unit.parts.map(() => 0) };
    order.counts[index] += item.quantity;
    invoices.set(id, order);
  }
  const days = new Map<string, number>();
  for (const { date, counts } of invoices.values()) {
    const quantity = Math.floor(Math.min(...counts.map((count, i) => count / unit.parts[i].quantity)));
    if (quantity > 0) days.set(date, (days.get(date) ?? 0) + quantity);
  }
  return days;
}
