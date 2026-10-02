"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import styles from "./login.module.css";

type AuthErrorLike = { message: string; status?: number; code?: string };

function translateAuthError(error: AuthErrorLike) {
  const normalizedMessage = error.message.toLowerCase();
  const status = error.status ?? 0;

  if (
    normalizedMessage.includes("invalid login credentials") ||
    normalizedMessage.includes("invalid credentials")
  ) {
    return "ایمیل یا رمز عبور درست نیست.";
  }

  if (normalizedMessage.includes("email not confirmed")) {
    return "ایمیل این حساب هنوز تأیید نشده است.";
  }

  if (normalizedMessage.includes("rate limit") || status === 429) {
    return "تعداد تلاش‌ها زیاد بوده است. کمی بعد دوباره امتحان کن.";
  }

  if (normalizedMessage.includes("invalid api key") || normalizedMessage.includes("no api key")) {
    return "کلید Supabase در تنظیمات Vercel نادرست است (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).";
  }

  // The browser talks to Supabase directly. No HTTP status means the request
  // never got an answer: no internet, a filtered network, or a wrong URL.
  if (
    status === 0 ||
    normalizedMessage.includes("failed to fetch") ||
    normalizedMessage.includes("network") ||
    normalizedMessage.includes("load failed")
  ) {
    return "اتصال به سرور Supabase برقرار نشد. اینترنت/VPN و آدرس NEXT_PUBLIC_SUPABASE_URL را بررسی کن.";
  }

  if (status >= 500) {
    return "سرور Supabase پاسخ نمی‌دهد. ممکن است پروژه در Supabase متوقف (Paused) شده باشد.";
  }

  return "ورود انجام نشد. اتصال اینترنت و اطلاعات ورود را بررسی کن.";
}

function technicalDetail(error: AuthErrorLike) {
  const parts = [error.status ? `HTTP ${error.status}` : "", error.code ?? "", error.message]
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.join(" · ").slice(0, 200);
}

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [errorDetail, setErrorDetail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setErrorDetail("");
    setIsSubmitting(true);

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(translateAuthError(signInError));
        setErrorDetail(technicalDetail(signInError));
        return;
      }

      router.replace("/");
      router.refresh();
    } catch (caught) {
      setError("ورود انجام نشد. متغیرهای Supabase در Vercel و اتصال اینترنت را بررسی کن.");
      setErrorDetail(caught instanceof Error ? caught.message.slice(0, 200) : "");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <label className={styles.field}>
        <span>ایمیل</span>
        <input
          type="email"
          name="email"
          dir="ltr"
          autoComplete="email"
          placeholder="name@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </label>

      <label className={styles.field}>
        <span>رمز عبور</span>
        <input
          type="password"
          name="password"
          dir="ltr"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={8}
          required
        />
      </label>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
          {errorDetail ? (
            <>
              <br />
              <small dir="ltr">{errorDetail}</small>
            </>
          ) : null}
        </p>
      ) : null}

      <button
        className={styles.submitButton}
        type="submit"
        disabled={isSubmitting || !email.trim() || password.length < 8}
      >
        {isSubmitting ? "در حال ورود…" : "ورود به برنامه"}
      </button>
    </form>
  );
}
