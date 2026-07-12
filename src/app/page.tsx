type IconName = "home" | "users" | "followup" | "assistant" | "report" | "upload" | "phone" | "calendar" | "chart";

function Icon({ name, size = 21 }: { name: IconName; size?: number }) {
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
  };

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

const menu = [
  { label: "امروز", icon: "home" as const, active: true },
  { label: "مشتریان", icon: "users" as const },
  { label: "پیگیری‌ها", icon: "followup" as const },
  { label: "دستیار هوش مصنوعی", icon: "assistant" as const },
  { label: "گزارش‌ها", icon: "report" as const },
];

const stats = [
  { title: "پیگیری امروز", value: "۰", note: "پس از ورود اطلاعات فعال می‌شود", icon: "phone" as const },
  { title: "پیگیری عقب‌افتاده", value: "۰", note: "همه‌چیز مرتب است", icon: "calendar" as const },
  { title: "مشتریان ثبت‌شده", value: "۰", note: "فایل هلو هنوز وارد نشده", icon: "users" as const },
  { title: "فروش این ماه", value: "—", note: "بعد از ورود تراکنش‌ها", icon: "chart" as const },
];

export default function Home() {
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
          {menu.map((item) => (
            <button className={`nav-item ${item.active ? "active" : ""}`} key={item.label} type="button">
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-status">
          <span className="status-dot" />
          <div>
            <strong>نسخه اولیه آماده است</strong>
            <p>مرحله بعد: اتصال بانک مشتریان</p>
          </div>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">یکشنبه، ۲۱ تیر ۱۴۰۵</p>
            <h1>سلام محمد، امروز چه چیزی را پیگیری کنیم؟</h1>
          </div>
          <div className="profile">
            <div className="avatar">م</div>
            <div>
              <strong>محمد امیدواری</strong>
              <span>مدیر فروش امیدمِد</span>
            </div>
          </div>
        </header>

        <section className="hero-card">
          <div>
            <span className="pill">مرحله اول پروژه</span>
            <h2>دفتر فروش هوشمندت آماده شروع است</h2>
            <p>
              در مرحله بعد، بانک مشتریان و تراکنش‌های هلو را وارد می‌کنیم تا برنامه بتواند مشتریان مناسب تماس و پیگیری را پیشنهاد دهد.
            </p>
          </div>
          <button className="primary-button" type="button" disabled>
            <Icon name="upload" size={19} />
            ورود فایل هلو — مرحله بعد
          </button>
        </section>

        <section className="stats-grid" aria-label="آمار فروش">
          {stats.map((stat) => (
            <article className="stat-card" key={stat.title}>
              <div className="stat-icon"><Icon name={stat.icon} /></div>
              <div>
                <span>{stat.title}</span>
                <strong>{stat.value}</strong>
                <p>{stat.note}</p>
              </div>
            </article>
          ))}
        </section>

        <section className="two-column">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <span className="section-kicker">برنامه فروش</span>
                <h3>کارهای امروز</h3>
              </div>
              <button className="text-button" type="button" disabled>مشاهده همه</button>
            </div>
            <div className="empty-state">
              <div className="empty-icon"><Icon name="followup" size={30} /></div>
              <h4>هنوز کاری ثبت نشده است</h4>
              <p>بعد از ورود اطلاعات مشتریان، پیگیری‌های پیشنهادی اینجا نمایش داده می‌شوند.</p>
            </div>
          </article>

          <article className="panel assistant-panel">
            <div className="panel-heading">
              <div>
                <span className="section-kicker">دستیار شخصی تو</span>
                <h3>از هوش مصنوعی بپرس</h3>
              </div>
              <div className="ai-badge"><Icon name="assistant" size={18} /> AI</div>
            </div>
            <div className="prompt-list">
              <button type="button" disabled>امروز با چه مشتری‌هایی تماس بگیرم؟</button>
              <button type="button" disabled>برای مشتری قدیمی یک پیام پیگیری بنویس.</button>
              <button type="button" disabled>فروش این ماه را تحلیل کن.</button>
            </div>
            <div className="chat-box">
              <span>پس از اتصال اطلاعات، سؤال خودت را اینجا می‌نویسی…</span>
              <button type="button" disabled>ارسال</button>
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
