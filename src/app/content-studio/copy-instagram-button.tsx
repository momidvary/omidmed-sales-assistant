"use client";

import { useState } from "react";

export default function CopyInstagramButton({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button className={className} type="button" onClick={copy}>
      {copied ? "کپی شد" : "کپی متن اینستاگرام"}
    </button>
  );
}

