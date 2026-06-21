"use client";

import { motion } from "motion/react";
import { RevealGroup, revealChild } from "@/components/Reveal";

interface Props {
  processors: string[];
}

export function IncludedList({ processors }: Props) {
  const items = [
    {
      label: "All processors — " + processors.join(", "),
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M2 10h20" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      ),
    },
    {
      label: "ML retry timing — Syzm Brain",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"
            fill="currentColor"
          />
        </svg>
      ),
    },
    {
      label: "Cross-processor routing",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M8 3L4 7l4 4M16 3l4 4-4 4M10 17H4m10 0h6M12 7v10"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
    {
      label: "Recovery dashboard",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M3 9h18" stroke="currentColor" strokeWidth="1.6" />
          <path d="M9 13h6M9 16h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      label: "Visa retry limits + compliance guards",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
    {
      label: "Dedicated onboarding — under 5 min / processor",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      ),
    },
  ];

  return (
    <RevealGroup className="grid gap-3 sm:grid-cols-2">
      {items.map(({ label, icon }) => (
        <motion.div
          key={label}
          variants={revealChild}
          className="flex items-center gap-3 text-sm text-muted"
        >
          <span className="flex-shrink-0 text-teal">{icon}</span>
          {label}
        </motion.div>
      ))}
    </RevealGroup>
  );
}
