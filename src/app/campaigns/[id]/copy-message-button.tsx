"use client";

import { useState } from "react";

export default function CopyMessageButton({
  template,
  customerName,
  className,
}: {
  template: string;
  customerName?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const text = template
    .replaceAll("{نام}", customerName ?? "")
    .replaceAll("{{name}}", customerName ?? "");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" className={className} onClick={copy}>
      {copied ? "کپی شد" : "کپی متن"}
    </button>
  );
}
