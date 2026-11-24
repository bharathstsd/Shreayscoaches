import { useEffect, useState } from "react";
import { api } from "../api";
import { Empty, Field, fmtDate, Loading, Sheet, stageTag, today, useAction, useLoad } from "../ui";
import { TrialCard } from "./Club";

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

const SOURCES = [
  ["WALKIN", "Walk-in", "Came on their own"],
  ["COUPON", "With a coupon", "A customer's invitation coupon"],
  ["EXTERNAL", "Referred by someone not in the app", "Friend outside the app or another club · complimentary visits"],
  ["OTHER", "Other", "Social media, event, etc."],
];

export function CustomerForm({ ctx, customer, onClose, onSaved, title }) {
  const coaches = useCoaches(ctx);
  const isNew = !customer;
  const [f, setF] = useState(customer ? { name: customer.name, mobile: customer.mobile, coach: customer.coach || "", gender: customer.gender || "", dob: customer.dob || "", notes: customer.notes || "" }
    : { source: "", name: "", mobile: "", coach: "", gender: "", dob: "", notes: "", invite_number: "", invite_batch: "", referrer_name: "", referrer_mobile: "", source_note: "", day1: true });
  const [more, setMore] = useState(!!customer);
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const head = (coaches.data || []).find((c) => c.is_head && c.is_active);
  async function save(e) {
    e.preventDefault();
    const body = { ...f, coach: f.coach || null, club: ctx.club };
    const r = await run(() => api(customer ? `customers/${customer.id}` : "customers", { method: customer ? "PATCH" : "POST", body, club: ctx.club }),
      (x) => x.message || x.warning || (customer ? "Customer saved." : `${x.name} added.`));
    if (r) onSaved(r);
  }
  const visits = f.source === "COUPON" || f.source === "EXTERNAL";
  return (
    <Sheet title={title || (customer ? "Edit customer" : "New customer")} onClose={onClose}>
      <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: "74vh", overflowY: "auto" }}>
        {isNew && <>
          <p className="lbl">How did they come?</p>
          <div className="pick">
            {SOURCES.map(([k, l, h]) => <button type="button" key={k} className={f.source === k ? "on" : ""} onClick={() => setF({ ...f, source: k })}><span className="t"><b>{l}</b><i>{h}</i></span></button>)}
          </div>
        </>}
        {(!isNew || f.source) && <>
          {f.source === "COUPON" && (
            <div className="btns">
              <Field label="Coupon number" id="fi" value={f.invite_number} onChange={set("invite_number")} inputMode="numeric" placeholder="e.g. 35" required />
              <Field label="Batch (only if asked)" id="fib" value={f.invite_batch} onChange={set("invite_batch")} placeholder="e.g. PB-0002" />
            </div>
          )}
          {f.source === "EXTERNAL" && <>
            <div className="btns">
              <Field label="Referred by (name)" id="frn" value={f.referrer_name} onChange={set("referrer_name")} placeholder="e.g. Sunita" required />
              <Field label="Their mobile (optional)" id="frm" value={f.referrer_mobile} onChange={set("referrer_mobile")} inputMode="numeric" />
            </div>
            <Field label="Where are they from? (optional)" id="frs" value={f.source_note} onChange={set("source_note")} placeholder="e.g. Sneha Wellness World, Chittoor" />
          </>}
          {f.source === "OTHER" && <Field label="How did they hear about us?" id="fos" value={f.source_note} onChange={set("source_note")} placeholder="e.g. Instagram, health camp" />}
          <Field label="Full name" id="fn" value={f.name} onChange={set("name")} required />
          <Field label="Mobile (10 digits)" id="fm" value={f.mobile} onChange={set("mobile")} inputMode="numeric" required />
          {visits && (
            <label style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer", fontSize: 14 }}>
              <input type="checkbox" checked={f.day1} onChange={(e) => setF({ ...f, day1: e.target.checked })} style={{ width: 20, height: 20 }} />
              <span>They're here today: record <b>Day 1</b> now{f.source === "EXTERNAL" ? " (complimentary)" : ""}</span>
            </label>
          )}
          <Field label="Wellness coach" id="fc" as="select" value={f.coach} onChange={set("coach")}>
            <option value="">{head ? `${head.name} · Head coach (default)` : "Not assigned yet"}</option>
            {(coaches.data || []).filter((c) => c.is_active && !c.is_head).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Field>
          {!more ? <button type="button" className="linkbtn" style={{ alignSelf: "flex-start" }} onClick={() => setMore(true)}>+ Gender, date of birth, notes</button> : <>
            <div className="btns">
              <Field label="Gender" id="fg" as="select" value={f.gender} onChange={set("gender")}><option value="">—</option><option>Female</option><option>Male</option><option>Other</option></Field>
              <Field label="Date of birth" id="fd" type="date" value={f.dob} onChange={set("dob")} max={new Date().toISOString().slice(0, 10)} />
            </div>
            <Field label="Notes" id="fo" as="textarea" value={f.notes} onChange={set("notes")} />
          </>}
          <div className="btns"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy}>Save</button></div>
        </>}
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
  const v = c.visit;
  const t = c.trial;
  const mine = (rec) => ctx.isAdmin || ctx.role === "OWNER" || rec.created_by === ctx.user.id;
  const post = (path, body, msg) => run(() => api(path, { method: "POST", club: ctx.club, body: { club: ctx.club, ...body } }), msg);
  async function pause(i) {
    const r = await run(() => api(`issues/${i.id}`, { method: "POST", club: ctx.club }), (x) => x.is_paused ? `${i.coupon} paused. It can't be used until resumed.` : `${i.coupon} active again.`);
    if (r) reload();
  }
  async function remove(i) {
    const r = await run(() => api(`issues/${i.id}`, { method: "DELETE", club: ctx.club }), (x) => x.message);
    if (r) reload();
  }
  const day = (n) => v && v.days.find((x) => x.day === n);
  const trialOpen = (c.purposes.find((p) => p.key === "TRIAL") || {}).locked === false;
  const cvcCoupon = c.purposes.find((p) => p.key !== "TRIAL" && !p.locked);

  // the single next step for this customer
  let next = null;
  if (v && !v.expired && !v.paused && v.can_d1) next = { title: `Record Day 1 · ${v.complimentary ? "complimentary visit" : "coupon " + v.coupon}`, btn: "Record Day 1", fn: async () => { if (await post("redemptions", { visit: v.id, day: 1 }, "Day 1 recorded.")) reload(); } };
  else if (v && !v.expired && !v.paused && day(1) && !day(2)) next = v.can_d2
    ? { title: `Record Day 2 · ${v.complimentary ? "complimentary visit" : "coupon " + v.coupon}`, btn: "Record Day 2", fn: async () => { if (await post("redemptions", { visit: v.id, day: 2 }, "Day 2 recorded. Both visits done.")) reload(); } }
    : { title: `Day 2 opens ${fmtDate(v.d2_opens)}`, sub: "Day 2 must be on a later day than Day 1.", btn: null };
  else if (!t && trialOpen) next = { title: "Start the 3-day trial", sub: "Give a 3-day trial coupon, or start the trial without one.", btn: "Issue trial coupon", fn: () => ctx.go("desk", "c" + c.id),
    alt: ["Start without a coupon", async () => { if (await post("trials", { customer: c.id }, `3-day trial started for ${c.name}.`)) reload(); }] };
  else if (t && !t.days.every(Boolean)) next = { trial: true };
  else if (t && !c.cvc) next = { title: "Trial completed · convert to CVC", btn: "Convert to CVC today", fn: async () => { if (await post("cvc", { customer: c.id, start_date: today() }, `${c.name} is now a CVC member.`)) reload(); }, alt: ["Pick another start date", () => ctx.go("cvc", c.id)] };
  else if (c.cvc) next = { title: cvcCoupon ? `Give a ${cvcCoupon.label} coupon` : "Record this week's check-up", btn: cvcCoupon ? "Issue coupon" : "Weekly results", fn: () => (cvcCoupon ? ctx.go("desk", "c" + c.id) : ctx.go("weekly")), alt: cvcCoupon ? ["Weekly results", () => ctx.go("weekly")] : null };

  const source = c.source === "COUPON" && v ? `Came with ${v.inviter}'s coupon ${v.coupon}` : c.source === "EXTERNAL" ? `Referred by ${c.referrer_name}${c.source_note ? " (" + c.source_note + ")" : ""}, not in the app` : c.source === "OTHER" ? `Other${c.source_note ? ": " + c.source_note : ""}` : "Walk-in";
  const events = [
    { at: c.created_at || null, title: "Added", sub: source },
    ...(v ? [{ title: v.complimentary ? "Complimentary visits" : `Friend's visit · coupon ${v.coupon}`, sub: [1, 2].map((n) => day(n) ? `Day ${n} ${fmtDate(day(n).at)}` : `Day ${n} —`).join(" · ") + (v.expired ? " · coupon expired" : "") }] : []),
    ...c.coupons.map((i) => ({ title: `Got coupon ${i.coupon} · ${i.purpose_label}`, sub: `${fmtDate(i.issued_at)} · ${i.visitor_name ? "used by " + i.visitor_name : i.is_paused ? "paused" : "not used yet"}` })),
    ...(t ? [{ title: "3-day trial", sub: t.days_at.map((d, i) => `Day ${i + 1} ${d ? fmtDate(d) : "—"}`).join(" · ") }] : []),
    ...(c.cvc ? [{ title: "Joined CVC", sub: "since " + fmtDate(c.cvc.start_date) }] : []),
  ];
  return (
    <>
      <div className="split">
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><p className="h2">{c.name}</p><button className="chip" onClick={() => setEditing(true)}>Edit</button></div>
          <p className="muted">{c.mobile} · Coach: {c.coach_name || "not assigned"}</p>
          <p className="muted" style={{ margin: 0 }}>{source}</p>
          <div className="chips"><span className={"tag " + (c.stage === "CVC member" ? "" : c.stage === "New" ? "grey" : "gold")}>{c.stage}</span></div>
          {c.notes && <p className="muted">{c.notes}</p>}
        </div>
        <div className="card" style={{ borderColor: "var(--gold)" }}>
          <p className="lbl">Next step</p>
          {!next && <p className="muted">Nothing to do right now.</p>}
          {next && next.trial && <TrialCard ctx={ctx} t={t} onChange={reload} bare />}
          {next && !next.trial && <>
            <b style={{ fontSize: 17 }}>{next.title}</b>
            {next.sub && <p className="muted" style={{ margin: 0 }}>{next.sub}</p>}
            {next.btn && <button className="btn" disabled={busy} onClick={next.fn}>{next.btn}</button>}
            {next.alt && <button className="linkbtn" onClick={next.alt[1]}>{next.alt[0]}</button>}
          </>}
        </div>
      </div>
      <div className="card">
        <p className="lbl">History</p>
        <div className="timeline">{events.map((e, i) => <div key={i} className="ev"><span className="dot" /><span className="grow"><b>{e.title}</b><span className="muted">{e.sub}</span></span></div>)}</div>
      </div>
      {c.coupons.some((i) => mine(i) && !i.visitor_name) && (
        <div className="card">
          <p className="lbl">Coupons not used yet</p>
          {c.coupons.filter((i) => !i.visitor_name).map((i) => (
            <div key={i.id} className="row" style={{ cursor: "default", flexWrap: "wrap" }}>
              <span className="grow"><b>{i.coupon} · {i.purpose_label}</b><span className="muted">{fmtDate(i.issued_at)}{i.expires_on ? " · valid until " + fmtDate(i.expires_on) : ""}</span></span>
              {i.is_paused && <span className="tag red">Paused</span>}
              {mine(i) && <><button className="chip" disabled={busy} onClick={() => pause(i)}>{i.is_paused ? "Resume" : "Pause (lost)"}</button><button className="chip" disabled={busy} onClick={() => remove(i)}>Undo issue</button></>}
            </div>
          ))}
        </div>
      )}
      {editing && <CustomerForm ctx={ctx} customer={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
    </>
  );
}
