import { api } from "../api";
import { Icon, Kv, Loading, useAction, useLoad } from "../ui";

export function Dashboard({ ctx, greeting }) {
  const { data, error } = useLoad("dashboard", { club: ctx.club });
  const [run, busy] = useAction();
  if (error) return <p className="err">{error}</p>;
  if (!data) return <Loading />;
  const k = data.kpis, c = data.conversion;
  const month = new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const top = data.funnel[0][1] || 1;

  async function exportCsv() {
    await run(async () => {
      const res = await api("export.csv", { club: ctx.club, raw: true });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "coupon-report.csv"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, "Report downloaded.");
  }

  return (
    <>
      {ctx.isAdmin && data.pending_resets > 0 && (
        <button className="banner warn" onClick={() => ctx.go("resets")}><Icon name="key" size={20} /><span><b>{data.pending_resets} password reset request{data.pending_resets > 1 ? "s" : ""}</b> waiting for you. Review now.</span></button>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div><p className="lbl">{data.scope} · {month}</p><p className="h2">{greeting}</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!ctx.isAdmin && <button className="btn" onClick={() => ctx.go("issue")}>Issue a coupon</button>}
          <button className="btn ghost" disabled={busy} onClick={exportCsv}>Export Excel / CSV</button>
        </div>
      </div>
      <div className="kpis k4">
        <div className="kpi"><b>{k.issued}</b><span>Coupons issued</span></div>
        <div className="kpi"><b>{k.visits}</b><span>Referral visitors</span></div>
        <div className="kpi"><b>{k.d1}</b><span>Day 1 redeemed</span></div>
        <div className="kpi"><b>{k.d2}</b><span>Fully redeemed</span></div>
        <div className="kpi"><b>{k.trials}</b><span>3-day trials</span></div>
        <div className="kpi"><b>{k.cvc}</b><span>CVC members</span></div>
        <div className="kpi"><b>{k.stock}</b><span>Coupons in stock</span></div>
        <div className="kpi"><b>{k.customers}</b><span>Customers</span></div>
      </div>
      <div className="kpis k4">
        <div className="kpi"><b>{c.customer}%</b><span>Customer conversion</span></div>
        <div className="kpi"><b>{c.trial_to_cvc}%</b><span>Trial → CVC</span></div>
        <div className="kpi"><b>{c.coupon_use}%</b><span>Coupon use (Day 1 ÷ issued)</span></div>
        <div className="kpi"><b>{c.referral}%</b><span>Referral conversion</span></div>
      </div>
      {data.clubs && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}><p className="lbl">Club comparison</p><span className="muted">Only you see this. Club Owners see their own club.</span></div>
          <div className="tbl-wrap"><table><thead><tr><th>Club</th><th>Issued</th><th>Day 1</th><th>Day 2</th><th>Trials</th><th>CVC</th><th>Trial → CVC</th></tr></thead><tbody>
            {data.clubs.map((cl) => (
              <tr key={cl.id} className={"click" + (cl.is_active ? "" : " dis")} onClick={() => ctx.go("club", cl.id)}>
                <td><b>{cl.name}</b> {!cl.is_active && <span className="tag red">Disabled</span>}</td><td>{cl.issued}</td><td>{cl.d1}</td><td>{cl.d2}</td><td>{cl.trials}</td><td>{cl.cvc}</td>
                <td><b>{cl.trials ? Math.round(cl.cvc / cl.trials * 100) + "%" : "—"}</b></td>
              </tr>
            ))}
          </tbody></table></div>
        </div>
      )}
      <div className="split">
        <div className="card">
          <p className="lbl">Conversion funnel</p>
          {data.funnel.map(([label, n], i) => (
            <div key={label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span>{label}</span>
                <b>{n} {i > 0 && <span style={{ fontWeight: 400, color: "var(--muted)" }}>{data.funnel[i - 1][1] ? Math.round(n / data.funnel[i - 1][1] * 100) + "%" : ""}</span>}</b></div>
              <div className="bar"><i style={{ width: Math.min(100, Math.round(n / top * 100)) + "%" }} /></div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card">
            <p className="lbl">Coach leaderboard</p>
            {data.coaches.length === 0 && <p className="muted">No coaches yet.</p>}
            {data.coaches.map((b, i) => (
              <div key={b.name + i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid #EFEBE2" }}>
                <span style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--gold-soft)", color: "var(--gold-ink)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 12 }}>{i + 1}</span>
                <span style={{ flex: 1, minWidth: 0 }}><b style={{ fontWeight: 600 }}>{b.name}</b><br /><span className="muted" style={{ fontSize: 12 }}>{b.herbalife_id || "—"} · {b.issued} issued · {b.trials} trials · {b.cvc} CVC</span></span>
                <b style={{ color: "var(--emerald)" }}>{b.efficiency}%</b>
              </div>
            ))}
          </div>
          <div className="card">
            <p className="lbl">Top inviters</p>
            {data.top_inviters.length === 0 && <p className="muted">No referrals yet.</p>}
            {data.top_inviters.map((t) => <Kv key={t.name} k={t.name} v={`${t.size} in network · ${t.converted} converted`} />)}
            {!ctx.isAdmin || ctx.club ? <button className="btn ghost" style={{ width: "100%" }} onClick={() => ctx.go("tree")}><Icon name="tree" size={18} />See referral trees</button> : null}
          </div>
        </div>
      </div>
      <div className="card">
        <p className="lbl">Redemptions · last 7 days</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", gap: 6, alignItems: "end", height: 120 }}>
          {data.trend.map((t) => {
            const max = Math.max(1, ...data.trend.map((x) => x.day1 + x.day2));
            const h = Math.round((t.day1 + t.day2) / max * 90);
            return (
              <div key={t.date} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }} title={`Day 1: ${t.day1}, Day 2: ${t.day2}`}>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>{t.day1 + t.day2}</span>
                <div style={{ width: "70%", height: Math.max(h, 2), borderRadius: 4, background: "var(--emerald-2)" }} />
                <span style={{ fontSize: 11, color: "var(--muted)" }}>{new Date(t.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
