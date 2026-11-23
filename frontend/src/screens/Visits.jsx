import { useEffect, useState } from "react";
import { api } from "../api";
import { CustomerForm, useCoaches } from "./Customers";
import { Empty, Field, fmtDate, Loading, Sheet, useAction, useLoad } from "../ui";

export function Visits({ ctx, arg }) {
  const [tab, setTab] = useState(arg === "redeem" ? "red" : "reg");
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 4, background: "#E9E4D8", padding: 4, borderRadius: 12, maxWidth: 520 }}>
        <button className={"chip" + (tab === "reg" ? " on" : "")} style={{ borderRadius: 9 }} onClick={() => setTab("reg")}>Register visitor</button>
        <button className={"chip" + (tab === "red" ? " on" : "")} style={{ borderRadius: 9 }} onClick={() => setTab("red")}>Redeem Day 1 / 2</button>
      </div>
      {tab === "reg" ? <Register ctx={ctx} onDone={() => setTab("red")} /> : <Redeem ctx={ctx} />}
    </>
  );
}

function Register({ ctx, onDone }) {
  const open = useLoad("issues?open=1", { club: ctx.club });
  const coaches = useCoaches(ctx);
  const [issue, setIssue] = useState(null);
  const [cq, setCq] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [visitor, setVisitor] = useState(null);
  const [coach, setCoach] = useState(null);
  const [adding, setAdding] = useState(false);
  const [run, busy] = useAction();
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const people = useLoad(issue ? "customers?limit=30" + (query ? "&q=" + encodeURIComponent(query) : "") : null, { club: ctx.club });

  if (open.error) return <p className="err">{open.error}</p>;
  if (!open.data) return <Loading />;
  const list = open.data.filter((i) => !cq || (i.coupon + i.customer_name).toLowerCase().includes(cq.toLowerCase()));
  const holderMobile = issue && issue.customer_mobile;

  async function save() {
    const r = await run(() => api("visits", { method: "POST", club: ctx.club, body: { club: ctx.club, issue: issue.id, visitor: visitor.id, coach } }),
      (x) => `${x.visitor_name} registered on ${x.coupon}. Now record Day 1.`);
    if (r) onDone();
  }

  return (
    <div className="split">
      <div className="card">
        <p className="lbl">1 · Which coupon did the friend bring?</p>
        <input className="inp" id="cq" placeholder="Search coupon number or holder" value={cq} onChange={(e) => setCq(e.target.value)} aria-label="Search coupon" />
        {list.length === 0 && <p className="muted">No issued coupons are waiting for a visitor.</p>}
        {list.slice(0, 30).map((i) => (
          <button key={i.id} className={"row" + (issue && issue.id === i.id ? " on" : "")} onClick={() => { setIssue(i); setVisitor(null); }}>
            <span className="grow"><b>{i.coupon}</b><span className="muted">Given to {i.customer_name} on {fmtDate(i.issued_at)}</span></span>
          </button>
        ))}
      </div>
      {issue ? (
        <div className="card">
          <p className="lbl">2 · Who is the visitor?</p>
          <input className="inp" id="visSearch" placeholder="Search name or mobile" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search visitor" />
          {!people.data ? <Loading /> : people.data.map((c) => {
            const isHolder = c.id === issue.customer || (holderMobile && c.mobile === holderMobile);
            return (
              <button key={c.id} className={"row" + (visitor && visitor.id === c.id ? " on" : "")} disabled={isHolder} onClick={() => setVisitor(c)}>
                <span className="grow"><b>{c.name}</b><span style={{ fontSize: 12 }}>{isHolder ? "Coupon holder: can't refer themselves" : c.mobile}</span></span>
              </button>
            );
          })}
          <button className="btn ghost" style={{ width: "100%" }} onClick={() => setAdding(true)}>+ New visitor not in the list</button>
          <p className="lbl" style={{ marginTop: 6 }}>3 · Assigned wellness coach</p>
          <div className="chips">{(coaches.data || []).filter((x) => x.is_active).map((x) => <button key={x.id} className={"chip" + (coach === x.id ? " on" : "")} onClick={() => setCoach(x.id)}>{x.name}</button>)}</div>
          {(coaches.data || []).length === 0 && <p className="muted">No coaches yet. The Club Owner adds coaches under More → Coaches.</p>}
          <button className="btn" style={{ width: "100%" }} disabled={!(visitor && coach) || busy} onClick={save}>Register visitor</button>
        </div>
      ) : <div className="card only-wide"><p className="muted">Pick the coupon the friend brought. Coupons can only be used at the club that issued them.</p></div>}
      {adding && <CustomerForm ctx={ctx} title="New visitor" onClose={() => setAdding(false)} onSaved={(c) => { setAdding(false); setVisitor(c); setQ(c.name); }} />}
    </div>
  );
}

function Redeem({ ctx }) {
  const { data, error, reload } = useLoad("visits?pending=1", { club: ctx.club });
  const all = useLoad("visits", { club: ctx.club });
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState("");
  const [voiding, setVoiding] = useState(null);
  const [reason, setReason] = useState("");
  const [run, busy] = useAction();
  if (error) return <p className="err">{error}</p>;
  if (!data || !all.data) return <Loading />;
  const fully = all.data.length - data.length;
  const list = data.filter((v) => !q || (v.visitor_name + v.visitor_mobile + v.coupon).toLowerCase().includes(q.toLowerCase()));
  const v = data.find((x) => x.id === sel);
  const mine = (r) => ctx.isAdmin || ctx.role === "OWNER" || r.created_by === ctx.user.id;

  async function redeem() {
    const day = v.day1 ? 2 : 1;
    const r = await run(() => api("redemptions", { method: "POST", club: ctx.club, body: { club: ctx.club, visit: v.id, day } }),
      `Day ${day} recorded for ${v.visitor_name}${day === 2 ? ". Coupon fully redeemed." : "."}`);
    if (r) { setSel(null); reload(); all.reload(); }
  }
  async function doVoid() {
    const r = await run(() => api(`redemptions/${voiding.id}/void`, { method: "POST", club: ctx.club, body: { reason } }), "Correction recorded. The original entry is kept in history.");
    if (r) { setVoiding(null); setReason(""); reload(); all.reload(); }
  }
  const recent = all.data.filter((x) => x.redemptions.length).slice(0, 8);

  return (
    <>
      <div className="split">
        <div className="card">
          <input className="inp" id="rq" placeholder="Search visitor name, mobile or coupon" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search visitor to redeem" />
          <p className="muted">{fully ? `${fully} fully redeemed coupon${fully > 1 ? "s are" : " is"} hidden from this list.` : "Visitors with Day 1 or Day 2 still to use."}</p>
          {list.length === 0 && <Empty>No visitors waiting.</Empty>}
          {list.map((x) => (
            <button key={x.id} className={"row" + (sel === x.id ? " on" : "")} onClick={() => setSel(x.id)}>
              <span className="grow"><b>{x.visitor_name}</b><span className="muted">{x.coupon} · invited by {x.inviter_name}</span></span>
              <span className={"tag " + (x.day1 ? "gold" : "grey")}>{x.day1 ? "Day 1 done" : "Not started"}</span>
            </button>
          ))}
        </div>
        {v ? (
          <div className="card">
            <p className="lbl">Which day?</p>
            <button className={"row" + (v.day1 ? "" : " on")} disabled={v.day1}><span style={{ flex: 1 }}><b>Day 1</b></span><span className={"tag " + (v.day1 ? "grey" : "gold")}>{v.day1 ? "Already redeemed" : "Selected"}</span></button>
            <button className={"row" + (v.day1 ? " on" : "")} disabled={!v.day1}><span style={{ flex: 1 }}><b>Day 2</b></span><span className={"tag " + (v.day1 ? "gold" : "grey")}>{v.day1 ? "Selected" : "Day 1 required first"}</span></button>
            <button className="btn" style={{ width: "100%" }} disabled={busy} onClick={redeem}>Record {v.day1 ? "Day 2" : "Day 1"} redemption</button>
            <p className="muted">Redemptions can't be deleted. Mistakes are fixed with a recorded correction.</p>
          </div>
        ) : <div className="card only-wide"><p className="muted">Pick a visitor to record their Day 1 or Day 2 visit. Day 2 opens only after Day 1.</p></div>}
      </div>
      {recent.length > 0 && (
        <div className="card">
          <p className="lbl">Recent redemptions</p>
          {recent.map((x) => x.redemptions.map((r) => (
            <div key={r.id} className="row" style={{ cursor: "default" }}>
              <span className="grow"><b>{x.visitor_name} · Day {r.day}</b><span className="muted">{x.coupon} · {new Date(r.at).toLocaleString("en-IN")}</span></span>
              {mine(r) && <button className="chip" onClick={() => setVoiding({ ...r, name: x.visitor_name })}>Correct</button>}
            </div>
          )))}
        </div>
      )}
      {voiding && (
        <Sheet title={`Correct Day ${voiding.day} for ${voiding.name}`} onClose={() => setVoiding(null)}>
          <p className="muted">The original entry stays in history, marked as corrected. It no longer counts as redeemed.</p>
          <Field label="Reason" id="vr" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. recorded for the wrong visitor" />
          <div className="btns"><button className="btn ghost" onClick={() => setVoiding(null)}>Cancel</button><button className="btn danger" disabled={!reason.trim() || busy} onClick={doVoid}>Record correction</button></div>
        </Sheet>
      )}
    </>
  );
}
