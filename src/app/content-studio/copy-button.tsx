"use client";

import { useState } from "react";

export default function CopyButton({
  text,
  label = "کپی متن",
  className,
  itemId,
}: {
  text: string;
  label?: string;
  className?: string;
  itemId?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      if (itemId) {
        void fetch(`/api/content-studio/items/${encodeURIComponent(itemId)}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventType: "copied" }),
        });
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button className={className} type="button" onClick={copy}>
      {copied ? "کپی شد" : label}
    </button>
  );
}
