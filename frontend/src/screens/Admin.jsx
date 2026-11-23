import { useState } from "react";
import { api } from "../api";
import { Dashboard } from "./Dashboard";
import { copyText, Empty, Field, fmtDate, Icon, Kv, Loading, Sheet, useAction, useLoad, useToast } from "../ui";

export function AdminHome({ ctx }) {
  return <Dashboard ctx={ctx} greeting={"Good " + greet() + ", " + (ctx.user.first_name || ctx.user.username)} />;
}
export const greet = () => { const h = new Date().getHours(); return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening"; };

// ---------------- clubs ----------------
export function Clubs({ ctx }) {
  const { data, error, reload } = useLoad("clubs");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  if (error) return <p className="err">{error}</p>;
  if (!data) return <Loading />;
  const list = data.filter((c) => !q || (c.name + c.city + (c.owner || "") + (c.supervisor || "")).toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input className="inp" id="clubSearch" style={{ flex: "1 1 240px" }} placeholder="Search clubs, cities or staff" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search clubs" />
        <button className="btn" onClick={() => setAdding(true)}>+ New club</button>
        <button className="btn ghost" onClick={() => ctx.go("import")}>Import from Excel</button>
      </div>
      <div className="kpis" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))" }}>
        {list.map((c) => (
          <button key={c.id} className="card" style={{ textAlign: "left", cursor: "pointer", ...(c.is_active ? {} : { background: "#F8F1F0", borderColor: "#E7CFCC" }) }} onClick={() => ctx.go("club", c.id)}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 42, height: 42, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", font: "600 18px var(--display)", ...(c.is_active ? { background: "var(--mint)", color: "var(--emerald)" } : { background: "#F0DEDC", color: "#7A2723" }) }}>{c.name.charAt(0)}</span>
              <span style={{ flex: 1, minWidth: 0 }}><b style={{ fontWeight: 600 }}>{c.name}</b><br /><span className="muted">{c.city}</span></span>
              <span className={"tag" + (c.is_active ? "" : " red")}>{c.is_active ? "Active" : "Disabled"}</span>
            </div>
            <Kv k="Club Owner" v={c.owner || "Not created"} /><Kv k="Supervisor" v={c.supervisor || "Not created"} /><Kv k="Coupons in stock" v={c.stock} />
          </button>
        ))}
      </div>
      {list.length === 0 && <Empty>{data.length ? "No club matches your search." : "No clubs yet. Add your first club."}</Empty>}
      <p className="muted">Disabled clubs always sit at the end of the list.</p>
      {adding && <ClubForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); ctx.refreshClubs(); }} />}
    </>
  );
}

function ClubForm({ club, onClose, onSaved }) {
  const [f, setF] = useState(club || { name: "", city: "", state: "Andhra Pradesh", address: "", pincode: "", owner_name: "", owner_mobile: "" });
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save(e) {
    e.preventDefault();
    const r = await run(() => api(club ? `clubs/${club.id}` : "clubs", { method: club ? "PATCH" : "POST", body: f }), club ? "Club details saved." : "Club created.");
    if (r) onSaved(r);
  }
  return (
    <Sheet title={club ? "Edit club" : "New club"} onClose={onClose}>
      <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Field label="Club name" id="cn" value={f.name} onChange={set("name")} required />
        <div className="btns"><Field label="City" id="cc" value={f.city} onChange={set("city")} /><Field label="Pincode" id="cp" value={f.pincode} onChange={set("pincode")} inputMode="numeric" /></div>
        <Field label="Address / landmark" id="ca" value={f.address} onChange={set("address")} />
        <div className="btns"><Field label="Owner name" id="con" value={f.owner_name} onChange={set("owner_name")} /><Field label="Owner mobile" id="com" value={f.owner_mobile} onChange={set("owner_mobile")} inputMode="numeric" /></div>
        <div className="btns"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy}>Save</button></div>
      </form>
    </Sheet>
  );
}

export function ClubDetail({ ctx, arg }) {
  const { data, error, reload } = useLoad(`clubs/${arg}`);
  const [run, busy] = useAction();
  const [editing, setEditing] = useState(false);
  const [staffForm, setStaffForm] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [newPw, setNewPw] = useState(null);
  const toast = useToast();
  if (error) return <p className="err">{error}</p>;
  if (!data) return <Loading />;
  const c = data;
  const roles = { OWNER: c.staff.find((s) => s.role === "OWNER" && s.is_active), SUPERVISOR: c.staff.find((s) => s.role === "SUPERVISOR" && s.is_active) };

  async function toggle() {
    setConfirm(false);
    const r = await run(() => api(`clubs/${c.id}/toggle`, { method: "POST" }), (x) => x.is_active ? `${c.name} enabled again.` : `${c.name} disabled. Its staff are logged out and new entries are blocked.`);
    if (r) { reload(); ctx.refreshClubs(); }
  }
  async function removeStaff(u) {
    const r = await run(() => api(`users/${u.id}`, { method: "DELETE" }), (x) => x.message || "Account deleted.");
    if (r) reload();
  }

  return (
    <>
      {!c.is_active && <div className="banner bad">This club is disabled. Its Owner and Supervisor can't log in and no new entries are allowed. History stays visible to you, read-only.</div>}
      <div className="split">
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><p className="h2">{c.name}</p><button className="chip" onClick={() => setEditing(true)}>Edit</button></div>
          <p className="muted">{[c.address, c.city, c.state, c.pincode].filter(Boolean).join(", ")}</p>
          <Kv k="Owner (contact)" v={c.owner_name || "—"} /><Kv k="Wellness coaches" v={c.coaches} /><Kv k="Coupons in stock" v={c.stock} />
          <p className="lbl" style={{ marginTop: 6 }}>Coupon ranges given to this club</p>
          {c.allocations.length ? c.allocations.map((a, i) => <Kv key={i} k={a.batch} v={`#${a.start} – #${a.end}`} />) : <p className="muted">None yet.</p>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="kpis" style={{ gridTemplateColumns: "repeat(2,minmax(0,1fr))" }}>
            <div className="kpi"><b>{c.issued}</b><span>Issued</span></div><div className="kpi"><b>{c.d2}</b><span>Fully redeemed</span></div>
            <div className="kpi"><b>{c.trials}</b><span>Trials</span></div><div className="kpi"><b>{c.cvc}</b><span>CVC</span></div>
          </div>
          <div className="card">
            <p className="lbl">Staff logins</p>
            <p className="muted">One Club Owner and one Supervisor per club. Username, mobile and Herbalife ID must be unique.</p>
            {["OWNER", "SUPERVISOR"].map((role) => {
              const s = roles[role];
              return s ? (
                <div key={role} className="row" style={{ cursor: "default" }}>
                  <span className="grow"><b>{s.name}</b><span className="muted">{role === "OWNER" ? "Club Owner" : "Supervisor"} · {s.username} · {s.mobile}{s.herbalife_id ? " · " + s.herbalife_id : ""}{s.upline_name ? " · upline " + s.upline_name : ""}</span></span>
                  <button className="chip" onClick={() => removeStaff(s)} disabled={busy}>Remove</button>
                </div>
              ) : (
                <button key={role} className="row" disabled={!c.is_active} onClick={() => setStaffForm(role)}><span className="grow"><b>+ Add {role === "OWNER" ? "Club Owner" : "Supervisor"}</b><span className="muted">{c.is_active ? "Creates a login with a temporary password" : "Enable the club first"}</span></span></button>
              );
            })}
            <p className="muted">Removing an account that has entries deactivates it instead, so history keeps its name.</p>
          </div>
          {!confirm ? (
            <button className={"btn" + (c.is_active ? " danger" : "")} style={{ width: "100%" }} onClick={() => (c.is_active ? setConfirm(true) : toggle())}>{c.is_active ? "Disable this club" : "Enable this club"}</button>
          ) : (
            <div className="card"><p style={{ margin: 0 }}>Disable <b>{c.name}</b>? Its staff are logged out at once and can't enter data until you enable it again.</p>
              <div className="btns"><button className="btn ghost" onClick={() => setConfirm(false)}>Cancel</button><button className="btn danger" onClick={toggle} disabled={busy}>Disable club</button></div></div>
          )}
        </div>
      </div>
      {editing && <ClubForm club={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); ctx.refreshClubs(); }} />}
      {staffForm && <StaffForm club={c} role={staffForm} onClose={() => setStaffForm(null)} onSaved={(r) => { setStaffForm(null); setNewPw(r); reload(); ctx.refreshClubs(); }} />}
      {newPw && (
        <Sheet title="Login created" onClose={() => setNewPw(null)}>
          <p className="muted">Share this once. {newPw.user.name} must change it at first login. It expires in 24 hours.</p>
          <div className="msg">{`Hello ${newPw.user.name},\nYour login for the Shreyas Wellness World Coupon System:\nUsername: ${newPw.user.username}\nTemporary Password: ${newPw.password}\nPlease log in and set your own password.`}</div>
          <div className="btns"><button className="btn ghost" onClick={() => copyText(newPw.password, toast)}>Copy password</button>
            <button className="btn" onClick={() => copyText(`Hello ${newPw.user.name},\nYour login for the Shreyas Wellness World Coupon System:\nUsername: ${newPw.user.username}\nTemporary Password: ${newPw.password}\nPlease log in and set your own password.`, toast)}>Copy WhatsApp message</button></div>
          <button className="linkbtn" onClick={() => setNewPw(null)}>Done</button>
        </Sheet>
      )}
    </>
  );
}

function StaffForm({ club, role, onClose, onSaved }) {
  const [f, setF] = useState({ first_name: "", last_name: "", username: "", mobile: "", herbalife_id: "", upline_name: "", upline_mobile: "", upline_herbalife_id: "" });
  const owner = role === "OWNER";
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save(e) {
    e.preventDefault();
    const r = await run(() => api("users", { method: "POST", body: { ...f, role, club: club.id } }));
    if (r) onSaved(r);
  }
  return (
    <Sheet title={`New ${role === "OWNER" ? "Club Owner" : "Supervisor"} · ${club.name}`} onClose={onClose}>
      <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="btns"><Field label="First name" id="sf" value={f.first_name} onChange={set("first_name")} required /><Field label="Last name" id="sl" value={f.last_name} onChange={set("last_name")} /></div>
        <div className="btns"><Field label="Mobile (10 digits)" id="sm" value={f.mobile} onChange={set("mobile")} inputMode="numeric" required /><Field label="Herbalife ID" id="sh" value={f.herbalife_id} onChange={set("herbalife_id")} required /></div>
        <Field label="Username (optional, the Herbalife ID is used if empty)" id="su" value={f.username} onChange={set("username")} autoCapitalize="none" />
        <p className="lbl" style={{ marginTop: 4 }}>Upline / sponsor{owner ? "" : " (optional)"}</p>
        <Field label="Upline name" id="un" value={f.upline_name} onChange={set("upline_name")} required={owner} />
        <div className="btns"><Field label="Upline mobile" id="um" value={f.upline_mobile} onChange={set("upline_mobile")} inputMode="numeric" required={owner} /><Field label="Upline Herbalife ID" id="uh" value={f.upline_herbalife_id} onChange={set("upline_herbalife_id")} required={owner} /></div>
        <div className="btns"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy}>Create login</button></div>
      </form>
    </Sheet>
  );
}

// ---------------- coupons ----------------
export function Coupons({ ctx }) {
  const b = useLoad("batches");
  const a = useLoad("allocations");
  const [run, busy] = useAction();
  const [adding, setAdding] = useState(false);
  const [del, setDel] = useState(null);
  if (b.error || a.error) return <p className="err">{b.error || a.error}</p>;
  if (!b.data || !a.data) return <Loading />;
  async function remove() {
    const x = del; setDel(null);
    const r = await run(() => api(`batches/${x.id}`, { method: "DELETE" }), `${x.code} and its coupon numbers were permanently deleted.`);
    if (r) { b.reload(); a.reload(); }
  }
  return (
    <>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btn" onClick={() => ctx.go("allocate")} disabled={!b.data.length}>Allocate a range to a club</button>
        <button className="btn ghost" onClick={() => setAdding(true)}>+ New print batch</button>
      </div>
      <div className="split">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p className="lbl">Print batches</p>
          {b.data.length === 0 && <Empty>No batches yet. Add the first print batch.</Empty>}
          {b.data.map((x) => (
            <div key={x.id} className="card">
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><span style={{ width: 12, height: 12, borderRadius: 3, background: x.color }} /><b style={{ flex: 1 }}>{x.code}{x.name ? " · " + x.name : ""}</b><span className="tag grey">#{x.start} – #{x.end}</span></div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, color: "var(--muted)" }}><span>{x.quantity} printed</span><span>{x.allocated} allocated</span><span>{x.issued} issued</span><span>{x.free} not allocated</span></div>
              {x.deletable ? <button className="btn danger" style={{ alignSelf: "flex-start" }} onClick={() => setDel(x)}>Delete batch permanently</button>
                : <span className="tag gold" style={{ alignSelf: "flex-start" }}><Icon name="lock" size={12} width={2} />In use ({x.issued} issued) · can't be deleted</span>}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p className="lbl">Ranges given to clubs</p>
          {a.data.length === 0 ? <Empty>Nothing allocated yet.</Empty> : (
            <div className="tbl-wrap"><table style={{ minWidth: 420 }}><thead><tr><th>Club</th><th>Batch</th><th>Numbers</th><th>Qty</th></tr></thead><tbody>
              {a.data.map((x) => <tr key={x.id}><td>{x.club}</td><td>{x.batch}</td><td>#{x.start} – #{x.end}</td><td>{x.quantity}</td></tr>)}
            </tbody></table></div>
          )}
        </div>
      </div>
      {adding && <BatchForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); b.reload(); }} />}
      {del && (
        <Sheet title={`Delete ${del.code}?`} onClose={() => setDel(null)}>
          <p style={{ margin: 0 }}>This permanently removes the batch, its {del.quantity} coupon numbers and any ranges given to clubs from it. No coupon from it has been issued. This can't be undone.</p>
          <div className="btns"><button className="btn ghost" onClick={() => setDel(null)}>Cancel</button><button className="btn danger" onClick={remove} disabled={busy}>Delete permanently</button></div>
        </Sheet>
      )}
    </>
  );
}

function BatchForm({ onClose, onSaved }) {
  const [f, setF] = useState({ name: "", start: "1", end: "1000", print_date: "" });
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save(e) {
    e.preventDefault();
    const r = await run(() => api("batches", { method: "POST", body: f }), (x) => `${x.code} created with ${x.quantity} coupons.`);
    if (r) onSaved(r);
  }
  return (
    <Sheet title="New print batch" onClose={onClose}>
      <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <p className="muted">Numbers can repeat across batches. Each coupon is identified by batch + number, so print the batch code on the bundle label.</p>
        <Field label="Batch name (optional)" id="bn" value={f.name} onChange={set("name")} placeholder="e.g. Diwali batch" />
        <div className="btns"><Field label="First number" id="bs" value={f.start} onChange={set("start")} inputMode="numeric" required /><Field label="Last number" id="be" value={f.end} onChange={set("end")} inputMode="numeric" required /></div>
        <Field label="Print date" id="bd" type="date" value={f.print_date} onChange={set("print_date")} />
        <div className="btns"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy}>Create batch</button></div>
      </form>
    </Sheet>
  );
}

export function Allocate({ ctx }) {
  const b = useLoad("batches");
  const a = useLoad("allocations");
  const [batch, setBatch] = useState(null);
  const [club, setClub] = useState(null);
  const [s, setS] = useState("");
  const [e, setE] = useState("");
  const [run, busy] = useAction();
  if (!b.data || !a.data) return <Loading />;
  const bt = b.data.find((x) => x.id === batch) || b.data[0];
  const taken = a.data.filter((x) => x.batch === bt.code);
  const maxEnd = taken.reduce((m, x) => Math.max(m, x.end), bt.start - 1);
  const ns = parseInt(s, 10), ne = parseInt(e, 10);
  let msg = "", ok = false;
  if (!club) msg = "Choose a club.";
  else if (isNaN(ns) || isNaN(ne)) msg = "Enter both numbers.";
  else if (ns > ne) msg = "“From” must be smaller than “To”.";
  else if (ns < bt.start || ne > bt.end) msg = `${bt.code} only has numbers #${bt.start} – #${bt.end}.`;
  else {
    const clash = taken.find((x) => ns <= x.end && ne >= x.start);
    if (clash) msg = `Numbers #${Math.max(ns, clash.start)} – #${Math.min(ne, clash.end)} already belong to ${clash.club}. A coupon can belong to only one club.`;
    else { msg = `${ne - ns + 1} coupons (${bt.code} #${ns} – #${ne}) will go to ${ctx.clubs.find((c) => c.id === club)?.name}.`; ok = true; }
  }
  async function save() {
    const r = await run(() => api("allocations", { method: "POST", body: { batch: bt.id, club, start: ns, end: ne } }), (x) => `${x.quantity} coupons allocated.`);
    if (r) { ctx.refreshClubs(); ctx.go("coupons"); }
  }
  return (
    <div className="split">
      <div className="card">
        <p className="lbl">1 · Print batch</p>
        <div className="chips">{b.data.map((x) => <button key={x.id} className={"chip" + (bt.id === x.id ? " on" : "")} onClick={() => setBatch(x.id)}>{x.code}</button>)}</div>
        <p className="muted">{maxEnd < bt.end ? `Next free numbers in ${bt.code}: #${maxEnd + 1} – #${bt.end}` : `Every number in ${bt.code} is allocated. Print a new batch.`}</p>
        <p className="lbl" style={{ marginTop: 6 }}>2 · Club</p>
        <div className="chips">{ctx.clubs.filter((c) => c.is_active).map((c) => <button key={c.id} className={"chip" + (club === c.id ? " on" : "")} onClick={() => setClub(c.id)}>{c.name}</button>)}</div>
        <p className="muted">Disabled clubs can't receive coupons.</p>
        <p className="lbl" style={{ marginTop: 6 }}>3 · Coupon numbers</p>
        <div className="btns"><Field label="From #" id="as" value={s} onChange={(x) => setS(x.target.value)} inputMode="numeric" /><Field label="To #" id="ae" value={e} onChange={(x) => setE(x.target.value)} inputMode="numeric" /></div>
        <div className={"banner " + (ok ? "ok" : "bad")}>{msg}</div>
        <button className="btn" style={{ width: "100%" }} disabled={!ok || busy} onClick={save}>Allocate coupons</button>
      </div>
      <div className="card">
        <p className="lbl">Already given out in {bt.code}</p>
        {taken.length ? taken.map((x) => <Kv key={x.id} k={x.club} v={`#${x.start} – #${x.end}`} />) : <p className="muted">Nothing yet.</p>}
      </div>
    </div>
  );
}

// ---------------- password resets ----------------
export function Resets() {
  const { data, error, reload } = useLoad("resets");
  const [run, busy] = useAction();
  const [gen, setGen] = useState({});
  const toast = useToast();
  if (error) return <p className="err">{error}</p>;
  if (!data) return <Loading />;
  async function generate(r) {
    const x = await run(() => api(`resets/${r.id}/generate`, { method: "POST" }));
    if (x) { setGen({ ...gen, [r.id]: x }); reload(); }
  }
  async function reject(r) {
    const x = await run(() => api(`resets/${r.id}/reject`, { method: "POST", body: {} }), "Request rejected.");
    if (x) reload();
  }
  return (
    <>
      <p className="muted" style={{ maxWidth: "62ch" }}>You never see anyone's password. You generate a one-time temporary password and send it on WhatsApp yourself. It expires in 24 hours and must be changed at first login.</p>
      {data.length === 0 && <Empty>No password reset requests.</Empty>}
      <div className="split even">
        {data.map((r) => (
          <div key={r.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b>{r.name}</b><span className={"tag " + (r.status === "PENDING" ? "gold" : r.status === "REJECTED" ? "red" : r.status === "COMPLETED" ? "" : "grey")}>{r.status.charAt(0) + r.status.slice(1).toLowerCase()}</span></div>
            <p className="muted">{r.role} · {r.club} · {fmtDate(r.created_at)}{r.reason ? ` · “${r.reason}”` : ""}</p>
            {gen[r.id] ? (
              <>
                <div className="pwd">{gen[r.id].password}</div>
                <div className="msg">{gen[r.id].message}</div>
                <div className="btns"><button className="btn ghost" onClick={() => copyText(gen[r.id].password, toast)}>Copy password</button><button className="btn" onClick={() => copyText(gen[r.id].message, toast)}>Copy WhatsApp message</button></div>
                <p className="muted">This password is shown only now.</p>
              </>
            ) : r.status === "PENDING" ? (
              <div className="btns"><button className="btn" disabled={busy} onClick={() => generate(r)}>Generate password</button><button className="btn ghost" disabled={busy} onClick={() => reject(r)}>Reject</button></div>
            ) : (r.status === "GENERATED" || r.status === "EXPIRED") ? (
              <button className="btn ghost" disabled={busy} onClick={() => generate(r)}>Generate a new password</button>
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}

export function AuditLog() {
  const { data, error } = useLoad("audit");
  if (error) return <p className="err">{error}</p>;
  if (!data) return <Loading />;
  return (
    <>
      <p className="muted">The latest 300 changes. Passwords are never recorded.</p>
      <div className="tbl-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Club</th><th>Action</th><th>Record</th></tr></thead><tbody>
        {data.map((a, i) => <tr key={i}><td>{new Date(a.at).toLocaleString("en-IN")}</td><td>{a.who}</td><td>{a.club}</td><td>{a.action.replace(/_/g, " ")}</td><td>{a.entity.replace(/_/g, " ")} {a.entity_id && "#" + a.entity_id}</td></tr>)}
      </tbody></table></div>
    </>
  );
}

// ---------------- Excel import ----------------
export function ImportExcel({ ctx }) {
  const [file, setFile] = useState(null);
  const [check, setCheck] = useState(null);
  const [result, setResult] = useState(null);
  const [run, busy] = useAction();
  const toast = useToast();

  async function send(commit) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("commit", commit ? "1" : "0");
    const r = await run(() => api("import", { method: "POST", body: fd }));
    if (!r) return;
    if (commit && r.created) { setResult(r); setCheck(null); ctx.refreshClubs(); toast("Import done."); }
    else setCheck(r);
  }
  function downloadCsv() {
    const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    const lines = [["Club", "Club Owner", "Mobile", "Username", "Temporary password", "WhatsApp message"].map(q).join(",")]
      .concat(result.logins.map((l) => [l.club, l.name, l.mobile, l.username, l.password, l.message].map(q).join(",")));
    const url = URL.createObjectURL(new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "club-owner-logins.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  if (result) {
    return (
      <>
        <div className="banner ok"><b>Created {result.summary.new_clubs} club(s), {result.logins.length} Club Owner login(s) and {result.coaches_created} coach(es).</b></div>
        {result.logins.length > 0 && (
          <>
            <div className="banner warn" style={{ cursor: "default" }}>These temporary passwords are shown only now and work for {result.expires_hours} hours. Send each message, or download the file, before leaving this page.</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="btn" onClick={downloadCsv}>Download logins (CSV)</button>
              <button className="btn ghost" onClick={() => copyText(result.logins.map((l) => l.message).join("\n\n"), toast)}>Copy all messages</button>
            </div>
            <div className="split even">
              {result.logins.map((l) => (
                <div key={l.username} className="card">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b>{l.name}</b><span className="tag">{l.club}</span></div>
                  <Kv k="Username" v={l.username} /><Kv k="Mobile" v={l.mobile} /><Kv k="Temporary password" v={l.password} />
                  <div className="btns">
                    <button className="btn ghost" onClick={() => copyText(l.message, toast)}>Copy message</button>
                    <a className="btn" style={{ textDecoration: "none" }} href={`https://wa.me/91${l.mobile}?text=${encodeURIComponent(l.message)}`} target="_blank" rel="noopener">Send on WhatsApp</a>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn ghost" onClick={() => ctx.go("clubs")}>See clubs</button>
          <button className="btn ghost" onClick={() => { setResult(null); setFile(null); }}>Import another file</button>
        </div>
      </>
    );
  }

  const s = check && check.summary;
  return (
    <>
      <div className="split">
        <div className="card">
          <p className="lbl">1 · Fill in the template</p>
          <p className="muted">Sheet <b>Clubs</b>: club, Club Owner and the Owner's upline / sponsor. Sheet <b>Coaches</b>: coach and the coach's upline / sponsor. Name, mobile and Herbalife ID are required for every person. You can fill only the Coaches sheet to add coaches to existing clubs.</p>
          <a className="btn ghost" style={{ textDecoration: "none", alignSelf: "flex-start" }} href="/club-import-template.xlsx?v=2" download="club-import-template.xlsx">Download template (.xlsx)</a>
          <p className="lbl" style={{ marginTop: 8 }}>2 · Upload it</p>
          <input className="inp" style={{ paddingTop: 10 }} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { setFile(e.target.files[0] || null); setCheck(null); }} aria-label="Excel file" />
          <button className="btn" style={{ width: "100%" }} disabled={!file || busy} onClick={() => send(false)}>{busy ? <span className="spin" /> : "Check file"}</button>
          <p className="muted">Checking changes nothing. You'll see every problem with its row number first.</p>
        </div>
        <div className="card">
          <p className="lbl">What gets created</p>
          <p className="muted">A club for each new club name, one Club Owner login per club (username = Herbalife ID, or they can use their mobile), and the coaches. Each Owner gets a temporary password to change at first login.</p>
          <p className="muted">Existing clubs are reused. Coaches already in a club (same mobile) are skipped.</p>
        </div>
      </div>
      {check && !check.ok && (
        <div className="card">
          <div className="banner bad"><b>{check.errors.length} problem{check.errors.length > 1 ? "s" : ""} to fix.</b>&nbsp;Nothing was created. Fix these rows in Excel and upload again.</div>
          <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>{check.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      {check && check.ok && (
        <div className="card">
          <div className="banner ok"><b>Everything looks good.</b>&nbsp;{s.new_clubs} new club(s), {s.owners} Club Owner login(s), {s.coaches} coach(es){s.coaches_skipped ? `, ${s.coaches_skipped} already in the app` : ""}.</div>
          {s.rows.length > 0 && (
            <div className="tbl-wrap"><table><thead><tr><th>Club</th><th>Club Owner</th><th>Mobile</th><th>Herbalife ID</th><th>Upline</th></tr></thead><tbody>
              {s.rows.map((r, i) => <tr key={i}><td>{r.club} {!r.new_club && <span className="tag grey">existing</span>}</td><td>{r.owner}</td><td>{r.mobile}</td><td>{r.herbalife_id}</td><td>{r.upline}</td></tr>)}
            </tbody></table></div>
          )}
          {s.coach_rows.length > 0 && (
            <div className="tbl-wrap"><table><thead><tr><th>Club</th><th>Coach</th><th>Mobile</th><th>Upline</th></tr></thead><tbody>
              {s.coach_rows.map((r, i) => <tr key={i}><td>{r.club}</td><td>{r.coach} {r.skip && <span className="tag grey">already added</span>}</td><td>{r.mobile}</td><td>{r.upline}</td></tr>)}
            </tbody></table></div>
          )}
          <button className="btn" disabled={busy} onClick={() => send(true)}>Create {s.new_clubs ? `${s.new_clubs} club(s), ` : ""}{s.owners} login(s) and {s.coaches} coach(es)</button>
        </div>
      )}
    </>
  );
}
