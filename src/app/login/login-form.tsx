"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import styles from "./login.module.css";

function translateAuthError(message: string) {
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes("invalid login credentials") ||
    normalizedMessage.includes("invalid credentials")
  ) {
    return "ایمیل یا رمز عبور درست نیست.";
  }

  if (normalizedMessage.includes("email not confirmed")) {
    return "ایمیل این حساب هنوز تأیید نشده است.";
  }

  if (normalizedMessage.includes("rate limit")) {
    return "تعداد تلاش‌ها زیاد بوده است. کمی بعد دوباره امتحان کن.";
  }

  return "ورود انجام نشد. اتصال اینترنت و اطلاعات ورود را بررسی کن.";
}

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(translateAuthError(signInError.message));
        return;
      }

      router.replace("/");
      router.refresh();
    } catch {
      setError("ورود انجام نشد. فایل .env.local و اتصال اینترنت را بررسی کن.");
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
