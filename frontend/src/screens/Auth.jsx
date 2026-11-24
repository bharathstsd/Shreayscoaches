import { useState } from "react";
import { api, setToken } from "../api";
import { Field, Icon } from "../ui";

export function Login({ onLogin }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState("");
  async function submit(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const r = await api("auth/login", { method: "POST", body: { username: u.trim(), password: p } });
      setToken(r.token);
      onLogin(r.user);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  async function request(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const r = await api("auth/forgot", { method: "POST", body: { username: u.trim(), reason } });
      setSent(r.message);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }

  return (
    <div className="login">
      <div className="brand">
        <Icon name="leaf" size={58} color="#D9B865" width={1.2} />
        <p className="kicker">SHREYAS WELLNESS WORLD</p>
        <h1>Coupon &amp; Referral</h1>
        <p>Track every coupon, visitor and conversion across your Nutrition Clubs.</p>
        <ul><li>Print batches and give each club its own coupon range</li><li>Follow each friend from Day 1 and Day 2 to trial and CVC</li><li>See which customers and coaches bring in new members</li></ul>
      </div>
      <div className="form">
        {!forgot ? (
          <form onSubmit={submit}>
            <p className="h2">Log in</p>
            <p className="muted" style={{ marginTop: -6 }}>Club Owners and Super Admins use the same login.</p>
            <Field label="Username or mobile" id="lu" value={u} onChange={(e) => setU(e.target.value)} placeholder="Username, Herbalife ID or mobile" autoComplete="username" autoCapitalize="none" required />
            <Field label="Password" id="lp" type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required />
            {err && <p className="err">{err}</p>}
            <button className="btn" style={{ width: "100%" }} disabled={busy}>{busy ? <span className="spin" /> : "Log in"}</button>
            <button type="button" className="linkbtn" onClick={() => { setForgot(true); setErr(""); setSent(""); }}>Forgot password?</button>
          </form>
        ) : (
          <form onSubmit={request}>
            <p className="h2">Forgot password</p>
            <p className="muted">Enter your Herbalife ID, username or registered mobile and tap <b>Send request</b>. The Super Admin will send you a temporary password on WhatsApp. If you are the only Super Admin, reset your password on the server with <code>deploy/manage.sh changepassword &lt;username&gt;</code>.</p>
            <Field label="Herbalife ID, username or mobile" id="fu" value={u} onChange={(e) => setU(e.target.value)} autoCapitalize="none" required />
            <Field label="Reason (optional)" id="fr" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. changed phone" />
            {err && <p className="err">{err}</p>}
            {sent && <div className="banner ok">{sent}</div>}
            <button className="btn" style={{ width: "100%" }} disabled={busy || !u.trim()}>{busy ? <span className="spin" /> : sent ? "Send again" : "Send request"}</button>
            <button type="button" className="linkbtn" onClick={() => { setForgot(false); setSent(""); setErr(""); }}>Back to log in</button>
          </form>
        )}
      </div>
    </div>
  );
}

export function ChangePassword({ forced, user, onDone, onLogout, ctx }) {
  const [cur, setCur] = useState("");
  const [n1, setN1] = useState("");
  const [n2, setN2] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const r = await api("auth/change-password", { method: "POST", body: { current: cur, new: n1, confirm: n2 } });
      setOk(true); setCur(""); setN1(""); setN2("");
      if (forced) onDone(r.user); else if (ctx) ctx.setUser(r.user);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  const form = (
    <form onSubmit={submit} className="card" style={{ maxWidth: 460, width: "100%" }}>
      <p className="h2">{forced ? "Set your own password" : "Change password"}</p>
      {forced && <p className="muted">You logged in with a temporary password. Choose a new one to continue.</p>}
      <Field label={forced ? "Temporary password" : "Current password"} id="pc" type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" required />
      <Field label="New password (at least 8 characters)" id="p1" type="password" value={n1} onChange={(e) => setN1(e.target.value)} autoComplete="new-password" required />
      <Field label="New password again" id="p2" type="password" value={n2} onChange={(e) => setN2(e.target.value)} autoComplete="new-password" required />
      {err && <p className="err">{err}</p>}
      {ok && !forced && <div className="banner ok">Password changed.</div>}
      <button className="btn" style={{ width: "100%" }} disabled={busy}>Save new password</button>
      {forced && <button type="button" className="linkbtn" onClick={onLogout}>Log out</button>}
    </form>
  );
  if (!forced) return form;
  return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, overflowY: "auto" }}>{form}</div>;
}
