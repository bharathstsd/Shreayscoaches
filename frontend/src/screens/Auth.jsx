import { useState } from "react";
import { api, setToken } from "../api";
import { Field, Icon } from "../ui";

const PORTALS = {
  club: { tab: "Club Owner", title: "Club Owner login", hint: "Your Herbalife ID or registered mobile" },
  admin: { tab: "Super Admin", title: "Super Admin login", hint: "Your Super Admin username or mobile" },
};

export function Login({ onLogin }) {
  const [portal, setPortalState] = useState(() => { try { return localStorage.getItem("sww_portal") === "admin" ? "admin" : "club"; } catch (e) { return "club"; } });
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  const [wrong, setWrong] = useState(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState("");
  const P = PORTALS[portal];

  function setPortal(x) {
    setPortalState(x); setErr(""); setWrong(null);
    try { localStorage.setItem("sww_portal", x); } catch (e) { /* ignore */ }
  }
  async function submit(e) {
    e.preventDefault();
    setErr(""); setWrong(null); setBusy(true);
    try {
      const r = await api("auth/login", { method: "POST", body: { username: u.trim(), password: p, portal } });
      setToken(r.token);
      onLogin(r.user, portal);
    } catch (x) {
      if (x.data && x.data.code === "wrong_portal") setWrong({ portal: x.data.portal, message: x.message });
      else setErr(x.message);
    } finally { setBusy(false); }
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
            <div className="seg" role="tablist" aria-label="Login type">
              {Object.entries(PORTALS).map(([k, v]) => (
                <button key={k} type="button" role="tab" aria-selected={portal === k} className={portal === k ? "on" : ""} onClick={() => setPortal(k)}>{v.tab}</button>
              ))}
            </div>
            <p className="h2">{P.title}</p>
            <Field label="Username or mobile" id="lu" value={u} onChange={(e) => setU(e.target.value)} placeholder={P.hint} autoComplete="username" autoCapitalize="none" required />
            <Field label="Password" id="lp" type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required />
            {err && <p className="err">{err}</p>}
            {wrong && (
              <div className="banner warn" style={{ flexDirection: "column", alignItems: "stretch", gap: 10, cursor: "default" }}>
                <span>{wrong.message}</span>
                <button type="button" className="btn" onClick={() => setPortal(wrong.portal)}>Go to {PORTALS[wrong.portal].title}</button>
              </div>
            )}
            <button className="btn" style={{ width: "100%" }} disabled={busy}>{busy ? <span className="spin" /> : "Log in"}</button>
            {portal === "club"
              ? <button type="button" className="linkbtn" onClick={() => { setForgot(true); setErr(""); setWrong(null); setSent(""); }}>Forgot password?</button>
              : <p className="muted" style={{ textAlign: "center" }}>Forgot the Super Admin password? Reset it on the server: <code>deploy/manage.sh changepassword &lt;username&gt;</code></p>}
          </form>
        ) : (
          <form onSubmit={request}>
            <p className="h2">Forgot password</p>
            <p className="muted">Enter your Herbalife ID, username or registered mobile and tap <b>Send request</b>. The Super Admin will send you a temporary password on WhatsApp.</p>
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
