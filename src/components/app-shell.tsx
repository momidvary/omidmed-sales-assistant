import Link from "next/link";

export type IconName =
  | "home"
  | "users"
  | "followup"
  | "assistant"
  | "report"
  | "upload"
  | "phone"
  | "calendar"
  | "chart"
  | "search"
  | "check";

export function Icon({ name, size = 21 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    home: <><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10.5V20h14v-9.5"/><path d="M9 20v-6h6v6"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
    followup: <><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/><path d="M12 7v5l3 2"/></>,
    assistant: <><path d="M12 2a3 3 0 0 0-3 3v1H7a4 4 0 0 0-4 4v3a4 4 0 0 0 4 4h1l2.5 3h3L16 17h1a4 4 0 0 0 4-4v-3a4 4 0 0 0-4-4h-2V5a3 3 0 0 0-3-3Z"/><path d="M8 11h.01M16 11h.01"/><path d="M9 14h6"/></>,
    report: <><path d="M4 19V9"/><path d="M10 19V5"/><path d="M16 19v-7"/><path d="M22 19H2"/></>,
    upload: <><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M20 16v4H4v-4"/></>,
    phone: <><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.84.57 2.8.7A2 2 0 0 1 22 16.92Z"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></>,
    chart: <><path d="M3 3v18h18"/><path d="m7 16 4-5 4 3 5-7"/></>,
    search: <><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></>,
    check: <><path d="m5 12 4 4L19 6"/></>,
  };

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

const menu = [
  { label: "امروز", icon: "home" as const, href: "/", key: "home" },
  { label: "مشتریان", icon: "users" as const, href: "/customers", key: "customers" },
  { label: "ورود اطلاعات", icon: "upload" as const, href: "/import", key: "import" },
  { label: "پیگیری‌ها", icon: "followup" as const, key: "followups" },
  { label: "دستیار هوش مصنوعی", icon: "assistant" as const, key: "assistant" },
  { label: "گزارش‌ها", icon: "report" as const, key: "reports" },
];

export default function AppShell({
  active,
  title,
  subtitle,
  children,
}: {
  active: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const today = new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "full",
    timeZone: "Asia/Tehran",
  }).format(new Date());

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">اُم</div>
          <div>
            <strong>امیدمِد</strong>
            <span>دستیار فروش شخصی</span>
          </div>
        </div>

        <nav className="nav" aria-label="منوی اصلی">
          {menu.map((item) => {
            const className = `nav-item ${active === item.key ? "active" : ""} ${!item.href ? "disabled" : ""}`;
            if (!item.href) {
              return (
                <span className={className} key={item.key} aria-disabled="true">
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </span>
              );
            }
            return (
              <Link className={className} href={item.href} key={item.key}>
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-status">
          <span className="status-dot" />
          <div>
            <strong>اتصال امن برقرار است</strong>
            <p>اطلاعات فقط در حساب شخصی تو ذخیره می‌شود.</p>
          </div>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">{today}</p>
            <h1>{title}</h1>
            {subtitle ? <p className="topbar-subtitle">{subtitle}</p> : null}
          </div>
          <div className="profile">
            <div className="avatar">م</div>
            <div className="profile-details">
              <strong>محمد امیدواری</strong>
              <span>مدیر فروش امیدمِد</span>
            </div>
            <form action="/auth/signout" method="post">
              <button className="signout-button" type="submit">خروج</button>
            </form>
          </div>
        </header>
        {children}
      </section>
    </main>
  );
}
