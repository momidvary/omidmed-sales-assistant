import Link from "next/link";
import styles from "./accounting-nav.module.css";

const items = [
  { key: "overview", href: "/accounting", label: "نمای کلی" },
  { key: "materials", href: "/accounting/materials", label: "مواد و قیمت خرید" },
  { key: "purchases", href: "/accounting/purchases", label: "فاکتورهای خرید" },
  { key: "purchase_scan", href: "/accounting/purchases/scan", label: "ثبت هوشمند فاکتور" },
  { key: "expenses", href: "/accounting/expenses", label: "هزینه‌های کارگاه" }, { key: "holo-accounting", href: "/accounting/import-holo", label: "\u0648\u0631\u0648\u062f \u0647\u0632\u06cc\u0646\u0647 \u0647\u0644\u0648" },
  { key: "payroll", href: "/accounting/payroll", label: "حقوق نیروها" },
  { key: "products", href: "/accounting/products", label: "فرمول محصولات" },
  { key: "pricing", href: "/accounting/pricing", label: "قیمت‌گذاری" },
];

export default function AccountingNav({ active }: { active: string }) {
  return (
    <nav className={styles.nav} aria-label="منوی حسابداری مدیریتی">
      {items.map((item) => (
        <Link
          href={item.href}
          key={item.key}
          className={active === item.key ? styles.active : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
