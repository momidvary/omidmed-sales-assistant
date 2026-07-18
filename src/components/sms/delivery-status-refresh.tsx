"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type RefreshResponse = {
  success?: boolean;
  checked?: number;
  delivered?: number;
  undelivered?: number;
  pending?: number;
  error?: string;
};

export default function DeliveryStatusRefresh() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshStatuses() {
    setLoading(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/sms/refresh-status", {
        method: "POST",
      });
      const data = (await response.json()) as RefreshResponse;

      if (!response.ok || data.error) {
        throw new Error(data.error || "بررسی وضعیت تحویل انجام نشد.");
      }

      setMessage(
        data.checked
          ? `بررسی ${data.checked} پیام: ${data.delivered ?? 0} تحویل‌شده، ${data.undelivered ?? 0} نرسیده و ${data.pending ?? 0} در انتظار.`
          : "پیام پذیرفته‌شده‌ای برای بررسی باقی نمانده است.",
      );
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "بررسی وضعیت تحویل انجام نشد.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        display: "grid",
        gap: 8,
        marginTop: 14,
        paddingTop: 14,
        borderTop: "1px solid #e3ecea",
      }}
    >
      <button
        type="button"
        onClick={refreshStatuses}
        disabled={loading}
        style={{
          border: 0,
          borderRadius: 10,
          padding: "10px 14px",
          background: "#1b6f8f",
          color: "white",
          font: "inherit",
          fontWeight: 800,
          cursor: loading ? "wait" : "pointer",
          opacity: loading ? 0.65 : 1,
        }}
      >
        {loading ? "در حال بررسی..." : "بررسی تحویل واقعی پیامک‌ها"}
      </button>

      {message ? (
        <small style={{ color: "#176a59", lineHeight: 1.8 }}>{message}</small>
      ) : null}
      {error ? (
        <small style={{ color: "#903f38", lineHeight: 1.8 }}>{error}</small>
      ) : null}
    </div>
  );
}
