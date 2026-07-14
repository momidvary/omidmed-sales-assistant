import AppShell from "@/components/app-shell";
import AccountingNav from "@/components/accounting-nav";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/accounting/format";
import { productCategoryLabels } from "@/lib/accounting/constants";
import ProductForm from "./product-form";
import styles from "../accounting.module.css";

type Product = {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  unit: string;
  direct_labor_per_unit: number | string;
  packaging_per_unit: number | string;
  other_variable_per_unit: number | string;
  current_cash_price: number | string | null;
};

type Component = {
  product_id: string;
  material_id: string;
  quantity_per_unit: number | string;
  waste_percent: number | string;
  material: { name: string; unit: string } | null;
};

export default async function ProductsPage() {
  const supabase = await createClient();
  const [materialResult, productResult, componentResult] = await Promise.all([
    supabase.from("materials").select("id,name,unit").eq("is_active", true).order("name"),
    supabase.from("costing_products").select("id,name,sku,category,unit,direct_labor_per_unit,packaging_per_unit,other_variable_per_unit,current_cash_price").eq("is_active", true).order("name"),
    supabase.from("product_materials").select("product_id,material_id,quantity_per_unit,waste_percent,material:materials(name,unit)").limit(5000),
  ]);
  const materials = materialResult.data ?? [];
  const products = (productResult.data ?? []) as Product[];
  const components = (componentResult.data ?? []) as unknown as Component[];
  const componentMap = new Map<string, Component[]>();
  for (const row of components) componentMap.set(row.product_id, [...(componentMap.get(row.product_id) ?? []), row]);
  const error = materialResult.error || productResult.error || componentResult.error;

  return (
    <AppShell active="accounting" title="فرمول ساخت محصولات" subtitle="برای هر محصول مشخص کن چه موادی و با چه مقدار مصرف می‌شوند.">
      <AccountingNav active="products" />
      {error ? <div className={styles.alert}>ابتدا SQL مرحله ۱۴ را اجرا کن. جزئیات: {error.message}</div> : null}
      {!materials.length ? <div className={styles.warning}>قبل از تعریف محصول، مواد اولیه و خدمات تولیدی را ثبت کن.</div> : null}

      <article className={`${styles.panel} ${styles.panelWide}`}>
        <header className={styles.panelHeader}><div><h2>محصول جدید و BOM</h2><p>فرمول یک واحد فروش را تعریف کن؛ مثلاً هزینه یک جفت پد یا یک عدد کیف.</p></div></header>
        {materials.length ? <ProductForm materials={materials} /> : <div className={styles.empty}>مواد اولیه‌ای برای انتخاب وجود ندارد.</div>}
      </article>

      <article className={`${styles.panel} ${styles.panelWide}`} style={{ marginTop: 16 }}>
        <header className={styles.panelHeader}><div><h2>محصولات تعریف‌شده</h2><p>{products.length.toLocaleString("fa-IR")} محصول آماده محاسبه قیمت است.</p></div></header>
        {products.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>محصول</th><th>گروه</th><th>مواد فرمول</th><th>دستمزد مستقیم</th><th>بسته‌بندی و متغیر</th><th>قیمت فعلی</th></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td><strong>{product.name}</strong><small>{product.sku || "بدون کد"} · واحد {product.unit}</small></td><td>{productCategoryLabels[product.category] ?? product.category}</td><td>{(componentMap.get(product.id) ?? []).map((item) => <span className={styles.status} key={item.material_id} style={{ margin: 2 }}>{item.material?.name ?? "ماده"}: {Number(item.quantity_per_unit).toLocaleString("fa-IR", { maximumFractionDigits: 4 })} {item.material?.unit}{Number(item.waste_percent) ? ` + ${Number(item.waste_percent).toLocaleString("fa-IR")}% ضایعات` : ""}</span>)}</td><td className={styles.numberCell}>{formatMoney(product.direct_labor_per_unit)}</td><td className={styles.numberCell}>{formatMoney(Number(product.packaging_per_unit) + Number(product.other_variable_per_unit))}</td><td className={styles.numberCell}>{product.current_cash_price == null ? "—" : formatMoney(product.current_cash_price)}</td></tr>)}</tbody></table></div> : <div className={styles.empty}>هنوز فرمول محصولی ثبت نشده است.</div>}
      </article>
    </AppShell>
  );
}
