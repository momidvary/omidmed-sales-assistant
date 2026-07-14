import Link from "next/link";
import styles from "./accounting-nav.module.css";

const items = [
  { key: "overview", href: "/accounting", label: "نمای کلی" },
  { key: "materials", href: "/accounting/materials", label: "مواد و قیمت خرید" },
  { key: "purchases", href: "/accounting/purchases", label: "فاکتورهای خرید" },
  { key: "expenses", href: "/accounting/expenses", label: "هزینه‌های کارگاه" },
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
