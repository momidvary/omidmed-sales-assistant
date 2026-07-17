import Link from "next/link";

import styles from "./accounting-nav.module.css";

const items = [
  { key: "overview", href: "/accounting", label: "نمای کلی" },
  { key: "materials", href: "/accounting/materials", label: "مواد و قیمت خرید" },
  { key: "purchases", href: "/accounting/purchases", label: "فاکتورهای خرید" },
  { key: "purchase_scan", href: "/accounting/purchases/scan", label: "ثبت هوشمند فاکتور" },
  { key: "expenses", href: "/accounting/expenses", label: "هزینه‌های کارگاه" },
  { key: "holo-accounting", href: "/accounting/import-holo", label: "ورود هزینه هلو" },
  { key: "payroll", href: "/accounting/payroll", label: "حقوق نیروها" },
  { key: "products", href: "/accounting/products", label: "فرمول محصولات" },
  { key: "cost_review", href: "/accounting/pricing/cost-review", label: "مرتب‌سازی هوشمند هزینه‌ها" },
  { key: "pricing_setup", href: "/accounting/pricing/setup", label: "آماده‌سازی قیمت هوشمند" },
  { key: "pricing", href: "/accounting/pricing", label: "قیمت‌گذاری" },
];

export default function AccountingNav({ active }: { active: string }) {
  return (
    <nav className={styles.nav} aria-label="منوی حسابداری مدیریتی">
      {items.map((item) => (
        <Link
          href={item.href}
          className={active === item.key ? styles.active : undefined}
          key={item.key}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
