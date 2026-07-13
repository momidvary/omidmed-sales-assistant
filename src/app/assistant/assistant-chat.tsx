"use client";

import { FormEvent, Fragment, KeyboardEvent, useEffect, useRef, useState } from "react";
import styles from "./assistant.module.css";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type ApiResponse = {
  answer?: string;
  error?: string;
  model?: string;
};

const suggestions = [
  "امروز با کدام مشتری‌ها تماس بگیرم و دلیل اولویت هرکدام چیست؟",
  "خریداران پد فرانسوی که موعد خرید مجددشان گذشته را پیدا کن.",
  "برای مشتری‌هایی که قیمت خواسته‌اند یک متن واتساپ محترمانه بنویس.",
  "فروش این ماه را با ماه قبل مقایسه و علت‌های احتمالی را از روی داده تحلیل کن.",
];

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function renderInline(text: string) {
  const pattern = /(\[[^\]]+\]\(\/customers\/[a-f0-9-]+\)|\*\*[^*]+\*\*)/gi;
  return text.split(pattern).map((part, index) => {
    const link = part.match(/^\[([^\]]+)\]\((\/customers\/[a-f0-9-]+)\)$/i);
    if (link) {
      return (
        <a className={styles.customerLink} href={link[2]} key={`${part}-${index}`}>
          {link[1]}
        </a>
      );
    }

    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    if (bold) return <strong key={`${part}-${index}`}>{bold[1]}</strong>;

    return <Fragment key={`${part}-${index}`}>{part}</Fragment>;
  });
}

function AssistantText({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className={styles.answerText}>
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <div className={styles.spacer} key={`space-${index}`} />;
        const bullet = trimmed.match(/^[-•]\s+(.+)$/);
        const numbered = trimmed.match(/^(\d+)[.)-]\s+(.+)$/);

        if (bullet) {
          return (
            <div className={styles.bullet} key={`line-${index}`}>
              <span>•</span><p>{renderInline(bullet[1])}</p>
            </div>
          );
        }

        if (numbered) {
          return (
            <div className={styles.bullet} key={`line-${index}`}>
              <span>{numbered[1]}.</span><p>{renderInline(numbered[2])}</p>
            </div>
          );
        }

        return <p key={`line-${index}`}>{renderInline(trimmed)}</p>;
      })}
    </div>
  );
}

export default function AssistantChat({ configured }: { configured: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  async function sendMessage(rawMessage?: string) {
    const message = (rawMessage ?? input).trim();
    if (!message || loading || !configured) return;

    const userMessage: Message = { id: newId(), role: "user", content: message };
    const history = messages.slice(-8).map(({ role, content }) => ({ role, content }));

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history }),
      });
      const data = (await response.json()) as ApiResponse;

      if (!response.ok || !data.answer) {
        throw new Error(data.error || "پاسخی دریافت نشد.");
      }

      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", content: data.answer as string },
      ]);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "در دریافت پاسخ خطایی رخ داد.",
      );
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return (
    <section className={styles.workspace}>
      <div className={styles.chatPanel}>
        <div className={styles.chatHeader}>
          <div>
            <span>تحلیل بر اساس داده واقعی امیدمِد</span>
            <h2>چه کمکی در فروش نیاز داری؟</h2>
          </div>
          <button
            className={styles.clearButton}
            disabled={!messages.length || loading}
            onClick={() => {
              setMessages([]);
              setError(null);
            }}
            type="button"
          >
            گفت‌وگوی جدید
          </button>
        </div>

        {!configured ? (
          <div className={styles.setupNotice}>
            <strong>کلید OpenAI هنوز تنظیم نشده است.</strong>
            <p>
              در فایل <code>.env.local</code> مقدار <code>OPENAI_API_KEY</code> را اضافه و سرور را دوباره اجرا کن.
            </p>
          </div>
        ) : null}

        <div className={styles.messages} aria-live="polite">
          {!messages.length ? (
            <div className={styles.welcome}>
              <div className={styles.aiMark}>AI</div>
              <h3>دستیار فروش آماده است</h3>
              <p>
                سؤال را معمولی و فارسی بنویس. فقط اطلاعات مرتبط و بدون شماره تماس یا آدرس مشتری برای تحلیل ارسال می‌شود.
              </p>
              <div className={styles.suggestions}>
                {suggestions.map((suggestion) => (
                  <button
                    disabled={!configured || loading}
                    key={suggestion}
                    onClick={() => void sendMessage(suggestion)}
                    type="button"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <article
                className={`${styles.message} ${styles[message.role]}`}
                key={message.id}
              >
                <div className={styles.messageLabel}>
                  {message.role === "user" ? "محمد" : "دستیار فروش"}
                </div>
                {message.role === "assistant" ? (
                  <AssistantText content={message.content} />
                ) : (
                  <p>{message.content}</p>
                )}
              </article>
            ))
          )}

          {loading ? (
            <div className={`${styles.message} ${styles.assistant}`}>
              <div className={styles.messageLabel}>دستیار فروش</div>
              <div className={styles.thinking}>
                <span /><span /><span />
                در حال بررسی اطلاعات فروش...
              </div>
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}

        <form className={styles.composer} onSubmit={submit}>
          <textarea
            disabled={!configured || loading}
            maxLength={2500}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="مثلاً: مشتری‌های خریدار پک اسپانیایی که بیشتر از دو ماه خرید نکرده‌اند را پیدا کن..."
            rows={3}
            value={input}
          />
          <div className={styles.composerFooter}>
            <span>Enter برای ارسال؛ Shift + Enter برای خط جدید</span>
            <button disabled={!configured || loading || !input.trim()} type="submit">
              {loading ? "در حال تحلیل..." : "ارسال سؤال"}
            </button>
          </div>
        </form>
      </div>

      <aside className={styles.sidePanel}>
        <div className={styles.infoCard}>
          <span className={styles.infoKicker}>دامنه دسترسی</span>
          <h3>دستیار چه چیزهایی را می‌بیند؟</h3>
          <ul>
            <li>خلاصه فروش و چرخه خرید مشتری</li>
            <li>فاکتورها و محصولات خریداری‌شده</li>
            <li>نتیجه تماس‌ها و موعد پیگیری</li>
            <li>اولویت و ارزش خرید مشتریان</li>
          </ul>
        </div>
        <div className={styles.infoCard}>
          <span className={styles.infoKicker}>کنترل کامل با توست</span>
          <h3>چه کاری خودکار انجام نمی‌شود؟</h3>
          <ul>
            <li>ارسال پیامک یا واتساپ</li>
            <li>تغییر فاکتور یا مانده حساب</li>
            <li>ویرایش اطلاعات مشتریان</li>
            <li>ثبت سفارش بدون تأیید تو</li>
          </ul>
        </div>
        <div className={styles.privacyNote}>
          پاسخ‌های API با <code>store: false</code> درخواست می‌شوند و کلید API فقط در سمت سرور استفاده می‌شود.
        </div>
      </aside>
    </section>
  );
}
