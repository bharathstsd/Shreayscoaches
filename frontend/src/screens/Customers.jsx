import { useEffect, useState } from "react";
import { api } from "../api";
import { Empty, Field, fmtDate, Loading, Sheet, stageTag, useAction, useLoad } from "../ui";

export function useCoaches(ctx) {
  return useLoad("coaches", { club: ctx.club });
}

export function Customers({ ctx }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const { data, error, reload } = useLoad("customers" + (query ? "?q=" + encodeURIComponent(query) : ""), { club: ctx.club });
  return (
    <>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input className="inp" id="custSearch" style={{ flex: "1 1 240px" }} placeholder="Search name or mobile" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" />
        <button className="btn" onClick={() => setAdding(true)}>+ New customer</button>
      </div>
      {error && <p className="err">{error}</p>}
      {!data ? <Loading /> : data.length === 0 ? <Empty>{query ? `No customer matches “${query}”.` : "No customers yet. Add the first one."}</Empty> : (
        <>
          <div className="only-narrow">
            {data.map((c) => (
              <button key={c.id} className="row" onClick={() => ctx.go("customer", c.id)}>
                <span style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--mint)", color: "var(--emerald)", display: "flex", alignItems: "center", justifyContent: "center", font: "600 17px var(--display)" }}>{c.name.charAt(0)}</span>
                <span className="grow"><b>{c.name}</b><span className="muted">{c.mobile} · {c.coach_name ? "Coach " + c.coach_name : "No coach yet"}</span></span>
                <span className={stageTag(c.stage)}>{c.stage}</span>
              </button>
            ))}
          </div>
          <div className="only-wide tbl-wrap"><table><thead><tr><th>Name</th><th>Mobile</th><th>Coach</th><th>Stage</th></tr></thead><tbody>
            {data.map((c) => <tr key={c.id} className="click" onClick={() => ctx.go("customer", c.id)}><td><b>{c.name}</b></td><td>{c.mobile}</td><td>{c.coach_name || <span className="muted">Not assigned</span>}</td><td><span className={stageTag(c.stage)}>{c.stage}</span></td></tr>)}
          </tbody></table></div>
        </>
      )}
      {adding && <CustomerForm ctx={ctx} onClose={() => setAdding(false)} onSaved={(c) => { setAdding(false); reload(); ctx.go("customer", c.id); }} />}
    </>
  );
}

export function CustomerForm({ ctx, customer, onClose, onSaved, title }) {
  const coaches = useCoaches(ctx);
  const [f, setF] = useState(customer ? { name: customer.name, mobile: customer.mobile, coach: customer.coach || "", gender: customer.gender || "", dob: customer.dob || "", notes: customer.notes || "" }
    : { name: "", mobile: "", coach: "", gender: "", dob: "", notes: "", invited: false, invite_number: "", invite_batch: "", day1: true });
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save(e) {
    e.preventDefault();
    const body = { ...f, coach: f.coach || null, club: ctx.club };
    if (!f.invited) { delete body.invite_number; delete body.invite_batch; delete body.day1; }
    delete body.invited;
    const r = await run(() => api(customer ? `customers/${customer.id}` : "customers", { method: customer ? "PATCH" : "POST", body, club: ctx.club }),
      (x) => x.message || x.warning || (customer ? "Customer saved." : `${x.name} added.`));
    if (r) onSaved(r);
  }
  return (
    <Sheet title={title || (customer ? "Edit customer" : "New customer")} onClose={onClose}>
      <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: "70vh", overflowY: "auto" }}>
        <Field label="Full name" id="fn" value={f.name} onChange={set("name")} required />
        <Field label="Mobile (10 digits)" id="fm" value={f.mobile} onChange={set("mobile")} inputMode="numeric" required />
        <Field label="Wellness coach" id="fc" as="select" value={f.coach} onChange={set("coach")}>
          <option value="">Not assigned yet</option>
          {(coaches.data || []).filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Field>
        <div className="btns">
          <Field label="Gender" id="fg" as="select" value={f.gender} onChange={set("gender")}><option value="">—</option><option>Female</option><option>Male</option><option>Other</option></Field>
          <Field label="Date of birth" id="fd" type="date" value={f.dob} onChange={set("dob")} />
        </div>
        <Field label="Notes" id="fo" as="textarea" value={f.notes} onChange={set("notes")} />
        {!customer && (
          <div className="card" style={{ padding: 12, gap: 10, background: "var(--ivory)" }}>
            <label style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" checked={f.invited} onChange={(e) => setF({ ...f, invited: e.target.checked })} style={{ width: 20, height: 20 }} />
              <span><b>Came with a friend's coupon</b><br /><span className="muted">Links them to the person who invited them</span></span>
            </label>
            {f.invited && <>
              <div className="btns">
                <Field label="Coupon number" id="fi" value={f.invite_number} onChange={set("invite_number")} inputMode="numeric" placeholder="e.g. 35" required />
                <Field label="Batch (only if asked)" id="fib" value={f.invite_batch} onChange={set("invite_batch")} placeholder="e.g. PB-0002" />
              </div>
              <label style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" checked={f.day1} onChange={(e) => setF({ ...f, day1: e.target.checked })} style={{ width: 20, height: 20 }} />
                <span>They're here today: record Day 1 now</span>
              </label>
            </>}
          </div>
        )}
        <div className="btns"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy}>Save</button></div>
      </form>
    </Sheet>
  );
}

export function Customer({ ctx, arg }) {
  const { data, error, reload } = useLoad(`customers/${arg}`, { club: ctx.club });
  const [editing, setEditing] = useState(false);
  const [run, busy] = useAction();
  if (error) return <p className="err">{error}</p>;
  if (!data) return <Loading />;
  const c = data;
  const mine = (rec) => ctx.isAdmin || ctx.role === "OWNER" || rec.created_by === ctx.user.id;
  async function pause(i) {
    const r = await run(() => api(`issues/${i.id}`, { method: "POST", club: ctx.club }), (x) => x.is_paused ? `${i.coupon} paused. It can't be used until resumed.` : `${i.coupon} active again.`);
    if (r) reload();
  }
  async function remove(i) {
    const r = await run(() => api(`issues/${i.id}`, { method: "DELETE", club: ctx.club }), (x) => x.message);
    if (r) reload();
  }
  return (
    <>
      <div className="split">
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><p className="h2">{c.name}</p><button className="chip" onClick={() => setEditing(true)}>Edit</button></div>
          <p className="muted">{c.mobile} · Coach: {c.coach_name || "not assigned"}</p>
          <div className="chips">
            <span className={"tag " + (c.trial ? "gold" : "grey")}>{!c.trial ? "No trial yet" : c.trial.status === "COMPLETED" ? "3-day trial completed" : "3-day trial in progress"}</span>
            <span className={"tag " + (c.cvc ? "" : "grey")}>{c.cvc ? "CVC member since " + fmtDate(c.cvc.start_date) : "Not a CVC member"}</span>
          </div>
          {c.notes && <p className="muted">{c.notes}</p>}
          <div className="btns" style={{ marginTop: 6 }}>
            {c.trial && c.trial.status === "COMPLETED" && !c.cvc
              ? <button className="btn gold" onClick={() => ctx.go("cvc", c.id)}>Convert to CVC</button>
              : <button className="btn" onClick={() => ctx.go("desk")}>Issue a coupon</button>}
            <button className="btn ghost" onClick={() => ctx.go(c.cvc ? "weekly" : "trials")}>{c.cvc ? "Weekly results" : "Trials"}</button>
          </div>
        </div>
        <div className="card">
          <p className="lbl">What this customer can get a coupon for</p>
          {c.purposes.map((p) => <div key={p.key} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 14 }}><span>{p.label}</span><span className={"tag " + (p.locked ? "grey" : "")}>{p.state}</span></div>)}
          <p className="muted">Order: 3-day trial first, then CVC, then weekly awards.</p>
        </div>
      </div>
      <div className="card">
        <p className="lbl">Coupons given to {c.name}</p>
        {c.coupons.length === 0 && <p className="muted">None yet.</p>}
        {c.coupons.map((i) => (
          <div key={i.id} className="row" style={{ cursor: "default", flexWrap: "wrap" }}>
            <span className="grow"><b>{i.coupon} · {i.purpose_label}</b><span className="muted">{fmtDate(i.issued_at)} · coach {i.coach_name} · {i.visitor_name ? "used by " + i.visitor_name : "not used yet"}</span></span>
            {i.is_paused && <span className="tag red">Paused</span>}
            {mine(i) && !i.visitor_name && <><button className="chip" disabled={busy} onClick={() => pause(i)}>{i.is_paused ? "Resume" : "Pause (lost)"}</button><button className="chip" disabled={busy} onClick={() => remove(i)}>Undo issue</button></>}
          </div>
        ))}
      </div>
      {editing && <CustomerForm ctx={ctx} customer={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
    </>
  );
}
