import { useState } from "react";
import { api } from "../api";
import { copyText, Field, Icon, Loading, Sheet, useAction, useLoad, useToast } from "../ui";

const ROLE = { ADMIN: ["Super Admin", "good"], OWNER: ["Club Owner", "gold"], SUPERVISOR: ["Supervisor", "grey"] };
const mob = (m) => (m && m.length === 10 ? m.slice(0, 5) + " " + m.slice(5) : m || "");
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Never");

function welcome(u, pw) {
  const site = window.location.host;
  return `Hello ${u.name},\nYour ${ROLE[u.role][0]} login for the Shreyas Wellness World Coupon System${u.club_name ? " (" + u.club_name + ")" : ""}:\n`
    + `Username: ${u.username}${u.mobile ? " (or your mobile " + u.mobile + ")" : ""}\nTemporary Password: ${pw}\n`
    + `Log in at https://${site}/ and set your own password.`;
}

export function Users({ ctx }) {
  const { data, error, reload } = useLoad("users");
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("active");
  const [form, setForm] = useState(null);
  const [pw, setPw] = useState(null);           // {name, password, message}
  const [confirm, setConfirm] = useState(null);
  const [run, busy] = useAction();
  const toast = useToast();
  if (error) return <p className="err">{error}</p>;
  if (!data) return <Loading />;

  const s = q.trim().toLowerCase();
  const digits = s.replace(/\D/g, "");
  const matchQ = (u) => !s || [u.name, u.username, u.club_name, u.herbalife_id].some((x) => (x || "").toLowerCase().includes(s)) || (digits.length >= 3 && (u.mobile || "").includes(digits));
  const matchS = (u) => status === "all" || (status === "active" ? u.is_active : status === "inactive" ? !u.is_active : u.is_active && u.must_change_password);
  const base = data.filter((u) => matchQ(u) && matchS(u));
  const rows = base.filter((u) => !role || u.role === role).sort((a, b) => (a.role === "ADMIN" ? 0 : 1) - (b.role === "ADMIN" ? 0 : 1) || (a.club_name || "").localeCompare(b.club_name || "") || a.name.localeCompare(b.name));
  const count = (r) => base.filter((u) => !r || u.role === r).length;

  async function reset(u) {
    const r = await run(() => api(`users/${u.id}/reset`, { method: "POST" }));
    if (r) setPw({ name: u.name, ...r });
  }
  async function toggle(u) {
    const r = u.is_active
      ? await run(() => api(`users/${u.id}`, { method: "DELETE" }), (x) => x.message || `${u.name} removed.`)
      : await run(() => api(`users/${u.id}`, { method: "PATCH", body: { is_active: true } }), `${u.name} can log in again.`);
    if (r) { reload(); ctx.refreshClubs(); }
  }
  const actions = (u) => u.id === ctx.user.id ? <span className="muted">You</span> : (
    <>
      <button className="chip" onClick={() => setForm(u)}>Edit</button>{" "}
      {u.is_active && <><button className="chip" disabled={busy} onClick={() => reset(u)}>Reset password</button>{" "}</>}
      <button className="chip" disabled={busy} onClick={() => (u.is_active ? setConfirm(u) : toggle(u))}>{u.is_active ? "Deactivate" : "Activate"}</button>
    </>
  );

  return (
    <>
      <div className="head"><div><p className="eyebrow">Admin console</p><h1 className="pg">Users</h1></div><button className="btn" style={{ width: "auto" }} onClick={() => setForm({})}>+ Add user</button></div>
      <section className="fbar">
        <div className="top2">
          <label className="sinp" htmlFor="uq"><Icon name="search" size={18} /><input id="uq" placeholder="Name, username, mobile, Herbalife ID or club" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" /></label>
          <select className="sel" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Active</option><option value="pending">Hasn't set a password yet</option><option value="inactive">Deactivated</option><option value="all">Everyone</option>
          </select>
        </div>
        <div className="fchips" role="group" aria-label="Role">
          {[["", "All"], ["ADMIN", "Super Admins"], ["OWNER", "Club Owners"], ["SUPERVISOR", "Supervisors"]].filter(([r]) => r !== "SUPERVISOR" || count("SUPERVISOR")).map(([r, l]) => (
            <button key={r || "all"} className={"chip" + (role === r ? " on" : "")} onClick={() => setRole(r)}>{l}<span className="n">{count(r)}</span></button>
          ))}
        </div>
      </section>
      <section className="panel">
        {rows.length === 0 ? <div className="empty"><b>No users match</b></div> : <>
          <div className="tw tblonly"><table><thead><tr><th>Name</th><th>Role</th><th>Club</th><th>Mobile</th><th>Herbalife ID</th><th>Last login</th><th /></tr></thead><tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td><b style={{ fontWeight: 500 }}>{u.name}</b><br /><span className="muted">{u.username}</span></td>
                <td><span className={"pill " + ROLE[u.role][1]}>{ROLE[u.role][0]}</span>{!u.is_active && <> <span className="pill bad">Deactivated</span></>}{u.is_active && u.must_change_password && <> <span className="pill warn">Temp password</span></>}</td>
                <td>{u.club_name || (u.owned_clubs && u.owned_clubs.length ? <span>Runs {u.owned_clubs.map((c) => c.name).join(", ")}</span> : <span className="muted">All clubs</span>)}</td>
                <td className="num">{mob(u.mobile)}</td>
                <td className="num">{u.herbalife_id || <span className="muted">—</span>}</td>
                <td className="muted">{when(u.last_login)}</td>
                <td style={{ textAlign: "right" }}>{actions(u)}</td>
              </tr>
            ))}
          </tbody></table></div>
          <div className="cards">
            {rows.map((u) => (
              <div key={u.id} className="pc" style={{ flexDirection: "column", alignItems: "stretch", cursor: "default" }}>
                <div className="lrow"><span className="t"><b>{u.name}</b><i>{u.username} · {mob(u.mobile)}{u.club_name ? " · " + u.club_name : ""}</i></span><span className={"pill " + (u.is_active ? ROLE[u.role][1] : "bad")}>{u.is_active ? ROLE[u.role][0] : "Deactivated"}</span></div>
                <div className="muted" style={{ fontSize: 12.5 }}>Last login: {when(u.last_login)}{u.is_active && u.must_change_password ? " · hasn't set a password yet" : ""}</div>
                <div>{actions(u)}</div>
              </div>
            ))}
          </div>
        </>}
      </section>
      {form && <UserForm ctx={ctx} user={form.id ? form : null} onClose={() => setForm(null)}
        onSaved={(r) => { setForm(null); reload(); ctx.refreshClubs(); if (r.password) setPw({ name: r.user.name, password: r.password, message: welcome(r.user, r.password) }); }} />}
      {confirm && (
        <Sheet title={`Deactivate ${confirm.name}?`} onClose={() => setConfirm(null)}>
          <p style={{ margin: 0 }}>{confirm.name} won't be able to log in. Everything they recorded stays. {confirm.role === "OWNER" && confirm.club_name ? `${confirm.club_name} will have no Club Owner login until you add one.` : ""}</p>
          <div className="btns"><button className="btn ghost" onClick={() => setConfirm(null)}>Cancel</button><button className="btn danger" disabled={busy} onClick={() => { const u = confirm; setConfirm(null); toggle(u); }}>Deactivate</button></div>
        </Sheet>
      )}
      {pw && (
        <Sheet title={`Temporary password · ${pw.name}`} onClose={() => setPw(null)}>
          <p className="muted">Shown only now. They'll be asked to set their own password when they log in.</p>
          <div className="pwd">{pw.password}</div>
          <div className="msg">{pw.message}</div>
          <div className="btns"><button className="btn ghost" onClick={() => copyText(pw.password, toast)}>Copy password</button><button className="btn" onClick={() => copyText(pw.message, toast)}>Copy WhatsApp message</button></div>
          <button className="linkbtn" onClick={() => setPw(null)}>Done</button>
        </Sheet>
      )}
    </>
  );
}

function UserForm({ ctx, user, onClose, onSaved }) {
  const isNew = !user;
  const clubs = useLoad("clubs");
  const [f, setF] = useState(user ? {
    role: user.role, first_name: user.first_name || "", last_name: user.last_name || "", mobile: user.mobile || "", herbalife_id: user.herbalife_id || "",
    username: user.username, club: user.club || "", upline_name: user.upline_name || "", upline_mobile: user.upline_mobile || "", upline_herbalife_id: user.upline_herbalife_id || "",
  } : { role: "OWNER", first_name: "", last_name: "", mobile: "", herbalife_id: "", username: "", club: "", upline_name: "", upline_mobile: "", upline_herbalife_id: "" });
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const owner = f.role !== "ADMIN";
  const freeClubs = (clubs.data || []).filter((c) => c.is_active && (String(c.id) === String(f.club) || (!c.owner && !c.admin_owner)));
  async function save(e) {
    e.preventDefault();
    const body = { ...f };
    if (!owner) { delete body.club; delete body.upline_name; delete body.upline_mobile; delete body.upline_herbalife_id; }
    if (!isNew) { delete body.role; if (!owner) delete body.club; }
    if (isNew && !body.username) delete body.username;
    const r = await run(() => api(isNew ? "users" : `users/${user.id}`, { method: isNew ? "POST" : "PATCH", body }), isNew ? "Login created." : "Saved.");
    if (r) onSaved(r);
  }
  return (
    <Sheet title={isNew ? "Add user" : `Edit ${user.name}`} onClose={onClose}>
      <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: "72vh", overflowY: "auto" }}>
        {isNew && (
          <div className="pick">
            <button type="button" className={f.role === "OWNER" ? "on" : ""} onClick={() => setF({ ...f, role: "OWNER" })}><span className="t"><b>Club Owner</b><i>Runs one club: coupons, visitors, trials, coaches</i></span></button>
            <button type="button" className={f.role === "ADMIN" ? "on" : ""} onClick={() => setF({ ...f, role: "ADMIN" })}><span className="t"><b>Super Admin</b><i>Sees every club, prints coupons, manages users</i></span></button>
          </div>
        )}
        <div className="rowflex"><Field label="First name" id="uf" value={f.first_name} onChange={set("first_name")} required /><Field label="Last name" id="ul" value={f.last_name} onChange={set("last_name")} /></div>
        <div className="rowflex"><Field label="Mobile (10 digits)" id="um" value={f.mobile} onChange={set("mobile")} inputMode="numeric" required /><Field label={owner ? "Herbalife ID" : "Herbalife ID (optional)"} id="uh" value={f.herbalife_id} onChange={set("herbalife_id")} required={owner} /></div>
        <Field label={isNew ? "Username (optional: Herbalife ID or mobile is used)" : "Username"} id="uu" value={f.username} onChange={set("username")} autoCapitalize="none" />
        {owner && (
          <Field label="Club" id="uc" as="select" value={f.club} onChange={set("club")} required={isNew}>
            <option value="">Choose the club…</option>
            {freeClubs.map((c) => <option key={c.id} value={c.id}>{c.name}{c.city ? " · " + c.city : ""}</option>)}
          </Field>
        )}
        {owner && isNew && clubs.data && freeClubs.length === 0 && <p className="muted">Every active club already has an owner. Create the club first in Clubs.</p>}
        {owner && <>
          <p className="lbl" style={{ marginTop: 4 }}>Upline / sponsor</p>
          <Field label="Name" id="un" value={f.upline_name} onChange={set("upline_name")} required />
          <div className="rowflex"><Field label="Mobile" id="upm" value={f.upline_mobile} onChange={set("upline_mobile")} inputMode="numeric" required /><Field label="Herbalife ID" id="uph" value={f.upline_herbalife_id} onChange={set("upline_herbalife_id")} required /></div>
        </>}
        <div className="btns"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy}>{isNew ? "Create login" : "Save"}</button></div>
      </form>
    </Sheet>
  );
}
