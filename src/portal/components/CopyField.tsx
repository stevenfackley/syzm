"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export default function CopyField({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className={cn("flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-bg/40 px-3 py-2.5", className)}>
      <code className="truncate font-mono text-xs text-muted">{value}</code>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-muted transition-colors hover:border-teal/40 hover:text-teal"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
