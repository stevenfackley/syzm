"use client";

import { motion } from "motion/react";
import { revealChild, RevealGroup } from "@/components/Reveal";

// Re-export so the parent doesn't need to import from motion/react
export { revealChild };

const faqs: { q: string; a: string }[] = [
  {
    q: "How is recovered revenue measured?",
    a: "A transaction is counted as recovered when a retry attempt succeeds and the charge clears within the window Syzm schedules. We compare your pre-integration baseline decline rate to post-integration outcomes. Every recovered transaction is auditable in the dashboard.",
  },
  {
    q: "Do you touch raw card data?",
    a: "No. Syzm never sees a card number, CVV, or expiry. We receive tokenized references from your processor's webhook — no PCI scope change on your end.",
  },
  {
    q: "Do I need to migrate my billing stack?",
    a: "No. Syzm sits behind your existing Stripe, Adyen, or Braintree setup. Add a webhook endpoint and credentials — nothing else moves.",
  },
  {
    q: "Which processors are supported?",
    a: "Stripe, Adyen, and Braintree. Additional processors are on the roadmap — contact us if yours isn't listed.",
  },
  {
    q: "How fast is setup?",
    a: "Under 5 minutes per processor. Configure a webhook URL, paste credentials, and Syzm starts ingesting decline events in real time.",
  },
  {
    q: "When does the success fee apply?",
    a: "Only when a retry succeeds and the charge settles. Failed retry attempts cost you nothing. The success fee is calculated on the gross recovered amount each billing period.",
  },
];

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 13l4 4L19 7" stroke="#2adfba" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function FaqList() {
  return (
    <RevealGroup className="mt-10 divide-y divide-white/8">
      {faqs.map(({ q, a }) => (
        <motion.div key={q} variants={revealChild} className="py-6">
          <div className="flex items-start gap-4">
            <span className="mt-0.5 flex-shrink-0 text-teal">
              <CheckIcon />
            </span>
            <div>
              <p className="font-semibold text-ink">{q}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">{a}</p>
            </div>
          </div>
        </motion.div>
      ))}
    </RevealGroup>
  );
}
