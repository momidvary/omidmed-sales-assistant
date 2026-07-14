export type CostingSettings = {
  monthly_fixed_overhead: number | string;
  overhead_mode?: string;
  include_payroll_in_overhead?: boolean;
  planned_monthly_output: number | string;
  default_min_margin: number | string;
  default_cash_margin: number | string;
  default_wholesale_margin: number | string;
  default_festival_margin: number | string;
  default_credit_monthly_rate: number | string;
  inflation_buffer_percent: number | string;
  stale_price_days: number | string;
  rounding_step: number | string;
};

export type CostingProduct = {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  unit: string;
  direct_labor_per_unit: number | string;
  packaging_per_unit: number | string;
  other_variable_per_unit: number | string;
  overhead_per_unit_override: number | string | null;
  min_margin: number | string | null;
  cash_margin: number | string | null;
  wholesale_margin: number | string | null;
  festival_margin: number | string | null;
  credit_days: number | string;
  credit_monthly_rate: number | string | null;
  current_cash_price: number | string | null;
};

export type ProductMaterial = {
  product_id: string;
  material_id: string;
  quantity_per_unit: number | string;
  waste_percent: number | string;
};

export type MaterialCost = {
  id: string;
  name: string;
  unit: string;
  latest_unit_cost: number | string | null;
  weighted_avg_unit_cost: number | string | null;
  replacement_unit_cost: number | string | null;
  latest_purchase_date: string | null;
  replacement_price_at: string | null;
};

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function marginPrice(cost: number, marginPercent: number) {
  const margin = Math.min(94.9, Math.max(0, marginPercent)) / 100;
  return cost / Math.max(0.051, 1 - margin);
}

function roundUp(value: number, step: number) {
  const safeStep = Math.max(1, step);
  return Math.ceil(value / safeStep) * safeStep;
}

export function calculateProductPricing({
  product,
  components,
  materialMap,
  settings,
}: {
  product: CostingProduct;
  components: ProductMaterial[];
  materialMap: Map<string, MaterialCost>;
  settings: CostingSettings;
}) {
  let historicalMaterialCost = 0;
  let averageMaterialCost = 0;
  let replacementMaterialCost = 0;
  const missingMaterials: string[] = [];
  const materialRows: Array<{
    name: string;
    quantity: number;
    wastePercent: number;
    historicalCost: number;
    averageCost: number;
    replacementCost: number;
  }> = [];

  for (const component of components) {
    const material = materialMap.get(component.material_id);
    if (!material) continue;
    const quantity = numeric(component.quantity_per_unit);
    const wastePercent = numeric(component.waste_percent);
    const effectiveQuantity = quantity * (1 + wastePercent / 100);
    const historical = numeric(material.latest_unit_cost);
    const average = numeric(material.weighted_avg_unit_cost);
    const replacement = numeric(material.replacement_unit_cost);

    if (!replacement) missingMaterials.push(material.name);
    historicalMaterialCost += effectiveQuantity * historical;
    averageMaterialCost += effectiveQuantity * average;
    replacementMaterialCost += effectiveQuantity * replacement;
    materialRows.push({
      name: material.name,
      quantity,
      wastePercent,
      historicalCost: effectiveQuantity * historical,
      averageCost: effectiveQuantity * average,
      replacementCost: effectiveQuantity * replacement,
    });
  }

  const directLabor = numeric(product.direct_labor_per_unit);
  const packaging = numeric(product.packaging_per_unit);
  const otherVariable = numeric(product.other_variable_per_unit);
  const defaultOverhead =
    numeric(settings.monthly_fixed_overhead) /
    Math.max(1, numeric(settings.planned_monthly_output));
  const overhead =
    product.overhead_per_unit_override == null
      ? defaultOverhead
      : numeric(product.overhead_per_unit_override);
  const nonMaterialCost = directLabor + packaging + otherVariable + overhead;

  const historicalCost = historicalMaterialCost + nonMaterialCost;
  const weightedAverageCost = averageMaterialCost + nonMaterialCost;
  const replacementCost = replacementMaterialCost + nonMaterialCost;
  const inflationBuffer = numeric(settings.inflation_buffer_percent);
  const protectedCost = replacementCost * (1 + inflationBuffer / 100);

  const minMargin = numeric(product.min_margin ?? settings.default_min_margin);
  const cashMargin = numeric(product.cash_margin ?? settings.default_cash_margin);
  const wholesaleMargin = numeric(
    product.wholesale_margin ?? settings.default_wholesale_margin,
  );
  const festivalMargin = numeric(
    product.festival_margin ?? settings.default_festival_margin,
  );
  const creditMonthlyRate = numeric(
    product.credit_monthly_rate ?? settings.default_credit_monthly_rate,
  );
  const creditDays = numeric(product.credit_days);
  const roundingStep = numeric(settings.rounding_step) || 1000;

  const minimumSafePrice = roundUp(
    marginPrice(protectedCost, minMargin),
    roundingStep,
  );
  const cashPrice = roundUp(marginPrice(protectedCost, cashMargin), roundingStep);
  const wholesalePrice = roundUp(
    marginPrice(protectedCost, wholesaleMargin),
    roundingStep,
  );
  const festivalPrice = roundUp(
    marginPrice(protectedCost, festivalMargin),
    roundingStep,
  );
  const creditPrice = roundUp(
    cashPrice * (1 + (creditMonthlyRate / 100) * (creditDays / 30)),
    roundingStep,
  );

  const currentCashPrice = numeric(product.current_cash_price);
  const currentMargin = currentCashPrice
    ? ((currentCashPrice - replacementCost) / currentCashPrice) * 100
    : null;

  return {
    historicalMaterialCost,
    averageMaterialCost,
    replacementMaterialCost,
    directLabor,
    packaging,
    otherVariable,
    overhead,
    historicalCost,
    weightedAverageCost,
    replacementCost,
    protectedCost,
    minimumSafePrice,
    cashPrice,
    wholesalePrice,
    festivalPrice,
    creditPrice,
    currentCashPrice,
    currentMargin,
    missingMaterials,
    materialRows,
    margins: {
      min: minMargin,
      cash: cashMargin,
      wholesale: wholesaleMargin,
      festival: festivalMargin,
      creditMonthlyRate,
      creditDays,
      inflationBuffer,
    },
  };
}
