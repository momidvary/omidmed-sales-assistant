"use client";

import { useState } from "react";

export default function CopyButton({
  text,
  label = "کپی متن",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

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
    <button className={className} type="button" onClick={copy}>
      {copied ? "کپی شد" : label}
    </button>
  );
}
