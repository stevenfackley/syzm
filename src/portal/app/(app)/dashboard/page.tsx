import type { Metadata } from "next";
import { getServerSupabase } from "@/lib/supabase";
import { formatUsd, formatPct } from "@/lib/utils";

export const metadata: Metadata = { title: "Recovery dashboard" };
export const dynamic = "force-dynamic";

interface DashboardMetrics {
  revenue_saved_today_cents: number | null;
  recovery_rate_today_pct: number | null;
  lifetime_churn_reduction_pct: number | null;
  success_by_processor: Record<string, number> | null;
}

export default async function DashboardPage() {
  const supabase = getServerSupabase();
  let row: DashboardMetrics | null = null;
  let connected = false;
  let errorMsg: string | null = null;

  if (supabase) {
    connected = true;
    const { data, error } = await supabase
      .from("syzm_dashboard_metrics")
      .select("revenue_saved_today_cents,recovery_rate_today_pct,lifetime_churn_reduction_pct,success_by_processor")
      .limit(1)
      .maybeSingle();
    if (error) errorMsg = error.message;
    else row = (data as DashboardMetrics) ?? null;
  }

  const kpis = [
    { label: "Revenue saved today", value: row ? formatUsd(row.revenue_saved_today_cents ?? 0) : "—" },
    { label: "Soft-decline recovery rate", value: row ? formatPct(row.recovery_rate_today_pct ?? 0, 1) : "—" },
    { label: "Lifetime churn reduction", value: row ? formatPct(row.lifetime_churn_reduction_pct ?? 0, 1) : "—" },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-extrabold">Recovery dashboard</h1>
        <p className="mt-1 text-muted">Live operational view of recovered revenue and retention impact.</p>
      </header>

      {!connected && (
        <div className="panel p-5 text-sm text-muted">
          <p className="font-medium text-ink">Not connected to live data.</p>
          <p className="mt-1">
            Set <code className="font-mono text-teal">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code className="font-mono text-teal">SUPABASE_SERVICE_ROLE_KEY</code> to read the{" "}
            <code className="font-mono">syzm_dashboard_metrics</code> view.
          </p>
        </div>
      )}
      {connected && errorMsg && (
        <div className="panel border-danger/30 p-5 text-sm text-danger">Query error: {errorMsg}</div>
      )}
      {connected && !errorMsg && !row && (
        <div className="panel p-5 text-sm text-muted">No recovery events recorded yet for this tenant.</div>
      )}

      <section className="grid gap-4 sm:grid-cols-3">
        {kpis.map((k) => (
          <article key={k.label} className="panel p-5">
            <p className="text-xs uppercase tracking-wider text-dim">{k.label}</p>
            <p className="mt-2 font-display text-3xl font-bold tabular-nums">{k.value}</p>
          </article>
        ))}
      </section>

      {row?.success_by_processor && (
        <section className="panel p-5">
          <h2 className="font-display text-lg font-bold">Recovery rate by processor</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {Object.entries(row.success_by_processor).map(([processor, pct]) => (
              <div key={processor} className="panel-2 p-4">
                <p className="text-sm capitalize text-muted">{processor}</p>
                <p className="mt-1 font-display text-2xl font-bold tabular-nums">{formatPct(Number(pct), 1)}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
