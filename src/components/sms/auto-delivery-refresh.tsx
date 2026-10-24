"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Asks Melipayamak for the delivery result of recent SMS when the page
// opens (at most every 30 minutes per browser), so an SMS that did not
// reach a customer puts them on the call list without anyone pressing
// "check delivery". Renders nothing.

const STORAGE_KEY = "omidmed.sms.delivery-checked-at";
const INTERVAL_MS = 30 * 60_000;

export default function AutoDeliveryRefresh() {
  const router = useRouter();

  useEffect(() => {
    let last = 0;
    try {
      last = Number(window.localStorage.getItem(STORAGE_KEY) ?? 0);
    } catch {
      // Storage unavailable: check on every visit.
    }
    if (Date.now() - last < INTERVAL_MS) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      // Ignore.
    }

    let cancelled = false;
    fetch("/api/sms/refresh-status", { method: "POST" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { undelivered?: number } | null) => {
        if (!cancelled && data?.undelivered) router.refresh();
      })
      .catch(() => {
        // A failed check is retried on a later visit.
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
