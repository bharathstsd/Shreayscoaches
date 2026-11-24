import { useState } from "react";
import { api } from "../api";
import { daysAgo, Empty, Field, fmtDate, Icon, Kv, Loading, Sheet, today, useAction, useLoad } from "../ui";

export function Launch({ ctx }) {
  const tiles = [["desk", "Coupon desk", "desk"], ["users", "Customers", "customers"], ["ref", "Referrals", "referrals"],
    ["trial", "3-day trials", "trials"], ["star", "CVC conversion", "cvc"], ["award", "Weekly results", "weekly"]];
  return (
    <div className="tiles">
      {tiles.map(([ic, label, to]) => (
        <button key={label} className="tile" onClick={() => ctx.go(to)}><span className="ic"><Icon name={ic} /></span><b>{label}</b></button>
      ))}
    </div>
  );
}

export function More({ ctx }) {
  const items = ctx.inClub ? [
    ["trial", "trials", "3-day trials", "Attendance for each day"], ["star", "cvc", "CVC membership", "Convert trial finishers"],
    ["award", "weekly", "Weekly results & awards", "Check-ups and Best Results"],
    ["coach", "coaches", "Wellness coaches", ctx.role === "SUPERVISOR" ? "View only" : "Add, edit and rank coaches"],
    ...(ctx.role !== "SUPERVISOR" ? [["tree", "tree", "Referral trees", "Who referred whom"]] : []),
    ["key", "password", "Change my password", "For your own account only"],
  ] : [
    ["upload", "import", "Import from Excel", "Clubs, Club Owners and coaches"], ["log", "audit", "Activity log", "Logins and every change"],
    ["key", "password", "Change my password", "For your own account only"],
  ];
  return (
    <div className="kpis" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))" }}>
      {items.map(([ic, to, label, sub]) => (
        <button key={to} className="row" onClick={() => ctx.go(to)}>
          <span style={{ width: 40, height: 40, borderRadius: 10, background: "var(--mint)", color: "var(--emerald)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name={ic} size={20} /></span>
          <span className="grow"><b>{label}</b><span className="muted">{sub}</span></span><Icon name="chev" size={18} />
        </button>
      ))}
    </div>
  );
}

export function Trials({ ctx }) {
  const { data, error, reload } = useLoad("trials", { club: ctx.club });
  const custs = useLoad("customers?limit=500", { club: ctx.club });
  const [run, busy] = useAction();
  const [starting, setStarting] = useState(false);
  const [q, setQ] = useState("");
  if (error) return <p className="err">{error}</p>;
  if (!data) return <Loading />;
  const mine = (t) => ctx.isAdmin || ctx.role === "OWNER" || t.created_by === ctx.user.id;
  async function toggle(t, i) {
    const days = t.days.slice(); days[i] = !days[i];
    const r = await run(() => api(`trials/${t.id}`, { method: "PATCH", club: ctx.club, body: { days } }), (x) => x.status === "COMPLETED" ? `${t.customer_name} completed the 3-day trial.` : null);
    if (r) reload();
  }
  async function start(c) {
    const r = await run(() => api("trials", { method: "POST", club: ctx.club, body: { club: ctx.club, customer: c.id } }), `3-day trial started for ${c.name}.`);
    if (r) { setStarting(false); reload(); custs.reload(); }
  }
  const eligible = (custs.data || []).filter((c) => c.stage === "New" && (!q || (c.name + c.mobile).toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <p className="muted" style={{ maxWidth: "60ch" }}>One 3-day trial per person, ever, across all clubs. Tap a day to mark attendance.</p>
        <button className="btn" onClick={() => setStarting(true)}>+ Start a trial</button>
      </div>
      {data.length === 0 && <Empty>No trials yet.</Empty>}
      <div className="kpis" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))" }}>
        {data.map((t) => (
          <div key={t.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b>{t.customer_name}</b><span className={"tag " + (t.status === "COMPLETED" ? "" : "gold")}>{t.status === "COMPLETED" ? "Completed" : t.status === "IN_PROGRESS" ? "In progress" : "Registered"}</span></div>
            <p className="muted">Started {fmtDate(t.start_date)}</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 6 }}>
              {t.days.map((x, i) => <button key={i} className={"chip" + (x ? " on" : "")} disabled={!mine(t) || busy} onClick={() => toggle(t, i)}>Day {i + 1}{x ? " ✓" : ""}</button>)}
            </div>
          </div>
        ))}
      </div>
      {starting && (
        <Sheet title="Start a 3-day trial" onClose={() => setStarting(false)}>
          <input className="inp" placeholder="Search name or mobile" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customer" />
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "50vh", overflowY: "auto" }}>
            {eligible.length === 0 && <p className="muted">No customers without a trial. New customers appear here.</p>}
            {eligible.map((c) => <button key={c.id} className="row" disabled={busy} onClick={() => start(c)}><span className="grow"><b>{c.name}</b><span className="muted">{c.mobile}</span></span><span className="tag">Start</span></button>)}
          </div>
        </Sheet>
      )}
    </>
  );
}

export function Cvc({ ctx }) {
  const custs = useLoad("customers?limit=500", { club: ctx.club });
  const members = useLoad("cvc", { club: ctx.club });
  const [sel, setSel] = useState(null);
  const [date, setDate] = useState(null);
  const [run, busy] = useAction();
  if (!custs.data || !members.data) return <Loading />;
  const candidates = custs.data.filter((c) => c.stage === "Trial done" || c.stage === "In trial");
  const dates = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => [daysAgo(n), n === 0 ? "Today" : n === 1 ? "Yesterday" : `${n} days ago`]);
  async function convert() {
    const c = candidates.find((x) => x.id === sel);
    const r = await run(() => api("cvc", { method: "POST", club: ctx.club, body: { club: ctx.club, customer: sel, start_date: date } }), `${c.name} is now a CVC member and can get a CVC coupon.`);
    if (r) { setSel(null); setDate(null); custs.reload(); members.reload(); }
  }
  return (
    <>
      <p className="muted" style={{ maxWidth: "62ch" }}>Only customers who attended all 3 trial days can join CVC. The start date must be today or within the last 7 days.</p>
      <div className="split">
        <div className="card">
          <p className="lbl">1 · Customer</p>
          {candidates.length === 0 && <p className="muted">Nobody is in or has finished a trial right now.</p>}
          {candidates.map((c) => {
            const ok = c.stage === "Trial done";
            return <button key={c.id} className={"row" + (sel === c.id ? " on" : "")} disabled={!ok} onClick={() => setSel(c.id)}><span className="grow"><b>{c.name}</b><span style={{ fontSize: 12 }}>{ok ? "Trial completed: eligible" : "Trial not completed yet"}</span></span></button>;
          })}
        </div>
        <div className="card">
          <p className="lbl">2 · Membership start date</p>
          <div className="chips">{dates.map(([iso, label]) => <button key={iso} className={"chip" + (date === iso ? " on" : "")} onClick={() => setDate(iso)}>{label}</button>)}</div>
          <p className="muted">Dates before {fmtDate(daysAgo(7))} or after {fmtDate(today())} aren't allowed.</p>
          <button className="btn" style={{ width: "100%" }} disabled={!(sel && date) || busy} onClick={convert}>Convert to CVC</button>
          <p className="lbl" style={{ marginTop: 10 }}>CVC members</p>
          {members.data.length === 0 && <p className="muted">None yet.</p>}
          {members.data.slice(0, 10).map((m) => <Kv key={m.id} k={m.customer_name} v={`since ${fmtDate(m.start_date)}${m.has_coupon ? " · coupon given" : ""}`} />)}
        </div>
      </div>
    </>
  );
}

export function Weekly({ ctx }) {
  const custs = useLoad("customers?limit=500", { club: ctx.club });
  const results = useLoad("weekly", { club: ctx.club });
  const [run, busy] = useAction();
  const [form, setForm] = useState(null);
  if (!custs.data || !results.data) return <Loading />;
  const members = custs.data.filter((c) => c.stage === "CVC member");
  const monday = (() => { const d = new Date(); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); })();
  async function save(e) {
    e.preventDefault();
    const r = await run(() => api("weekly", { method: "POST", club: ctx.club, body: { club: ctx.club, customer: form.customer, week_start: monday, weight: form.weight, waist: form.waist } }), "Checkup saved.");
    if (r) { setForm(null); results.reload(); }
  }
  async function approve(w) {
    const r = await run(() => api(`weekly/${w.id}/approve`, { method: "POST", club: ctx.club }), `${w.customer_name} can now get a Weekly Results coupon.`);
    if (r) results.reload();
  }
  const canApprove = ctx.isAdmin || ctx.role === "OWNER";
  return (
    <>
      <p className="muted">Weekly checkups are for CVC members. An approved Best Results award earns a coupon.</p>
      <div className="split">
        <div className="card">
          <p className="lbl">Record this week's checkup (week of {fmtDate(monday)})</p>
          {members.length === 0 && <p className="muted">No CVC members yet.</p>}
          {members.map((c) => <button key={c.id} className="row" onClick={() => setForm({ customer: c.id, name: c.name, weight: "", waist: "" })}><span className="grow"><b>{c.name}</b><span className="muted">{c.mobile}</span></span><span className="tag">Add checkup</span></button>)}
        </div>
        <div className="card">
          <p className="lbl">Recent checkups</p>
          {results.data.length === 0 && <p className="muted">None yet.</p>}
          {results.data.slice(0, 20).map((w) => (
            <div key={w.id} className="row" style={{ cursor: "default" }}>
              <span className="grow"><b>{w.customer_name}</b><span className="muted">Week of {fmtDate(w.week_start)} · {w.weight ? w.weight + " kg" : "—"} · {w.waist ? w.waist + " in" : "—"}</span></span>
              {w.award_approved ? <span className="tag gold">{w.has_coupon ? "Coupon given" : "Award approved"}</span>
                : canApprove ? <button className="chip" disabled={busy} onClick={() => approve(w)}>Approve award</button> : null}
            </div>
          ))}
        </div>
      </div>
      {form && (
        <Sheet title={`Checkup · ${form.name}`} onClose={() => setForm(null)}>
          <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="btns"><Field label="Weight (kg)" id="ww" inputMode="decimal" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} /><Field label="Waist (in)" id="wa" inputMode="decimal" value={form.waist} onChange={(e) => setForm({ ...form, waist: e.target.value })} /></div>
            <div className="btns"><button type="button" className="btn ghost" onClick={() => setForm(null)}>Cancel</button><button className="btn" disabled={busy}>Save checkup</button></div>
          </form>
        </Sheet>
      )}
    </>
  );
}

export function CoachForm({ ctx, coach, onClose, onSaved, extra }) {
  const [f, setF] = useState(coach ? { ...coach, upline_name: coach.upline_name || "", upline_mobile: coach.upline_mobile || "", upline_herbalife_id: coach.upline_herbalife_id || "" }
    : { name: "", mobile: "", herbalife_id: "", upline_name: "", upline_mobile: "", upline_herbalife_id: "" });
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save(e) {
    e.preventDefault();
    const r = await run(() => api(coach ? `coaches/${coach.id}` : "coaches", { method: coach ? "PATCH" : "POST", club: ctx.club, body: { ...f, club: ctx.club } }), coach ? "Coach saved." : `${f.name} added to the coach list.`);
    if (r) onSaved(r);
  }
  return (
    <Sheet title={coach ? "Edit coach" : "New coach"} onClose={onClose}>
      <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Field label="Coach name" id="kn" value={f.name} onChange={set("name")} required />
        <div className="btns"><Field label="Mobile (10 digits)" id="km" value={f.mobile} onChange={set("mobile")} inputMode="numeric" required /><Field label="Herbalife ID" id="kh" value={f.herbalife_id} onChange={set("herbalife_id")} required /></div>
        <p className="lbl" style={{ marginTop: 4 }}>Upline / sponsor</p>
        <Field label="Upline name" id="kun" value={f.upline_name} onChange={set("upline_name")} required />
        <div className="btns"><Field label="Upline mobile" id="kum" value={f.upline_mobile} onChange={set("upline_mobile")} inputMode="numeric" required /><Field label="Upline Herbalife ID" id="kuh" value={f.upline_herbalife_id} onChange={set("upline_herbalife_id")} required /></div>
        {extra}
        <div className="btns"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy}>Save</button></div>
      </form>
    </Sheet>
  );
}

export function Coaches({ ctx }) {
  const { data, error, reload } = useLoad("coaches", { club: ctx.club });
  const [form, setForm] = useState(null);
  const [run] = useAction();
  if (error) return <p className="err">{error}</p>;
  if (!data) return <Loading />;
  const canEdit = ctx.role !== "SUPERVISOR";
  async function toggle(c) {
    const r = await run(() => api(`coaches/${c.id}`, { method: "PATCH", club: ctx.club, body: { is_active: !c.is_active } }), c.is_active ? `${c.name} marked inactive.` : `${c.name} active again.`);
    if (r) reload();
  }
  return (
    <>
      {!canEdit && <div className="banner info">View only. The Club Owner adds and edits coaches.</div>}
      {data.length === 0 ? <Empty>No coaches yet.</Empty> : (
        <div className="tbl-wrap"><table style={{ minWidth: 620 }}><thead><tr><th>Coach</th><th>Mobile</th><th>Herbalife ID</th><th>Upline</th><th>Status</th>{canEdit && <th />}</tr></thead><tbody>
          {data.map((c) => (
            <tr key={c.id}><td><b>{c.name}</b></td><td>{c.mobile}</td><td>{c.herbalife_id || "—"}</td><td>{c.upline_name ? `${c.upline_name} · ${c.upline_herbalife_id}` : "—"}</td><td><span className={"tag" + (c.is_active ? "" : " grey")}>{c.is_active ? "Active" : "Inactive"}</span></td>
              {canEdit && <td style={{ whiteSpace: "nowrap" }}><button className="chip" onClick={() => setForm(c)}>Edit</button> <button className="chip" onClick={() => toggle(c)}>{c.is_active ? "Deactivate" : "Activate"}</button></td>}</tr>
          ))}
        </tbody></table></div>
      )}
      {canEdit && <button className="btn" onClick={() => setForm({})}>+ Add coach</button>}
      {form && <CoachForm ctx={ctx} coach={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} />}
    </>
  );
}

export function Tree({ ctx }) {
  const { data, error } = useLoad("referral-tree", { club: ctx.club });
  const [sel, setSel] = useState(0);
  if (error) return <p className="err">{error}</p>;
  if (!data) return <Loading />;
  if (data.length === 0) return <Empty>No referrals yet. Trees appear once friends visit with coupons.</Empty>;
  const t = data[Math.min(sel, data.length - 1)];
  const share = [`${t.root}'s referral network (${t.size} people, ${t.converted} converted)`, ...t.nodes.filter((n) => n.generation > 0).map((n) => `${"  ".repeat(n.generation - 1)}G${n.generation} ${n.name}, referred by ${n.parent} (${n.coupon})`)].join("\n");
  return (
    <>
      <div className="chips">{data.slice(0, 20).map((x, i) => <button key={x.root_id} className={"chip" + (i === sel ? " on" : "")} onClick={() => setSel(i)}>{x.root} · {x.size}</button>)}</div>
      <div className="split">
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}><b>{t.root}'s network</b><span className="tag gold">{t.size} people · {t.converted} converted</span></div>
          <p className="muted">Who referred whom, and the coupon each friend brought.</p>
          {t.nodes.map((n) => (
            <div key={n.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: `9px 0 9px ${n.generation * 20}px`, borderBottom: "1px solid #EFEBE2" }}>
              {n.generation > 0 && <span style={{ color: "#B9B1A0" }}>└</span>}
              <span className={"tag " + (n.generation === 0 ? "gold" : "")}>{n.generation === 0 ? "Root" : "G" + n.generation}</span>
              <span style={{ flex: 1, minWidth: 0 }}><b style={{ fontWeight: 600, fontSize: 14 }}>{n.name}</b><br />
                <span className="muted" style={{ fontSize: 12 }}>{n.generation === 0 ? "Started the chain" : `Brought ${n.coupon} from ${n.parent}`}{n.cvc ? " · CVC" : n.trial_done ? " · trial done" : n.trial ? " · in trial" : n.day2 ? " · Day 2 done" : n.day1 ? " · Day 1 done" : ""}</span></span>
              {n.converted && <span className="tag">Converted</span>}
            </div>
          ))}
          <a className="btn" style={{ width: "100%", textDecoration: "none" }} href={"https://wa.me/?text=" + encodeURIComponent(share)} target="_blank" rel="noopener">Share tree on WhatsApp</a>
        </div>
        <div className="card">
          <p className="lbl">Network summary</p>
          <Kv k="Total in network" v={t.size} />
          {Object.entries(t.generations).map(([g, n]) => <Kv key={g} k={`Generation ${g}`} v={n} />)}
          <Kv k="Converted (Day 2, trial or CVC)" v={t.converted} /><Kv k="Deepest generation" v={t.depth ? "G" + t.depth : "—"} />
        </div>
      </div>
    </>
  );
}
