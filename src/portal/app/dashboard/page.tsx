export default function DashboardPage() {
  const revenueSavedToday = 18234;
  const lifetimeChurnReduction = 2.8;
  const recoveryRate = 31.2;

  return (
    <main className="grid" style={{ gap: 18 }}>
      <section className="card">
        <h1>Recovery Dashboard</h1>
        <p className="muted">Real-time operational view of recovered revenue and retention impact.</p>
      </section>

      <section className="grid grid-3">
        <article className="card">
          <h3>Revenue Saved Today</h3>
          <p>${revenueSavedToday.toLocaleString()}</p>
        </article>
        <article className="card">
          <h3>Lifetime Churn Reduction</h3>
          <p>{lifetimeChurnReduction}%</p>
        </article>
        <article className="card">
          <h3>Soft Decline Recovery Rate</h3>
          <p>{recoveryRate}%</p>
        </article>
      </section>
    </main>
  );
}

