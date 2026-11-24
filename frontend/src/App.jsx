import { useCallback, useEffect, useState } from "react";
import { api, hasToken, setToken, setUnauthorizedHandler } from "./api";
import { Icon, Loading, ToastProvider } from "./ui";
import { ChangePassword, Login } from "./screens/Auth";
import { Allocate, AuditLog, ClubDetail, Clubs, Coupons, ImportExcel, Resets } from "./screens/Admin";
import { Customer } from "./screens/Customers";
import { Cvc, Launch, More, Tree, Trials, Weekly } from "./screens/Club";
import { AdminOverview, ClubHome, CoachesList, CustomersList, DeskPage, ReferralsList, SearchOverlay } from "./screens/V2";

// Pages per workspace. The Admin console looks after every club; a club workspace is where coupons, visitors and programs are recorded.
const ADMIN_PAGES = {
  overview: ["Overview", AdminOverview], clubs: ["Clubs", Clubs], club: ["Club details", ClubDetail], coupons: ["Coupons", Coupons],
  allocate: ["Allocate coupons", Allocate], resets: ["Password resets", Resets], import: ["Import from Excel", ImportExcel],
  audit: ["Activity log", AuditLog], password: ["Change password", ChangePassword], more: ["More", More],
};
const CLUB_PAGES = {
  home: ["Home", ClubHome], desk: ["Coupon desk", DeskPage], customers: ["Customers", CustomersList], customer: ["Customer", Customer],
  referrals: ["Referrals", ReferralsList], trials: ["3-day trials", Trials], cvc: ["CVC membership", Cvc], weekly: ["Weekly results", Weekly],
  coaches: ["Coaches", CoachesList], tree: ["Referral trees", Tree], more: ["More", More], password: ["Change password", ChangePassword],
};

const SELF_TITLED = ["overview", "home", "desk", "customers", "referrals", "coaches", "clubs", "password"];

function parseHash() {
  const h = (window.location.hash || "").replace(/^#/, "");
  const i = h.indexOf("/");
  const name = i < 0 ? h : h.slice(0, i);
  const arg = i < 0 ? null : decodeURIComponent(h.slice(i + 1));
  return { name: name || "", arg: arg || null };
}
const store = {
  get: (k) => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
};
const initials = (s) => (s || "").split(/[\s·]+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

export default function App() {
  return <ToastProvider><Shell /></ToastProvider>;
}

function Shell() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(hasToken());
  const [route, setRoute] = useState(parseHash());
  const [ws, setWs] = useState(() => store.get("sww_ws") || "admin");
  const [clubs, setClubs] = useState([]);
  const [menu, setMenu] = useState(null);       // "ws" | "me" | null
  const [search, setSearch] = useState(false);
  const [clubQ, setClubQ] = useState("");

  const logoutLocal = useCallback(() => { setToken(null); setUser(null); }, []);
  useEffect(() => { setUnauthorizedHandler(logoutLocal); }, [logoutLocal]);
  useEffect(() => {
    if (!hasToken()) return;
    api("auth/me").then(setUser).catch(() => setToken(null)).finally(() => setBooting(false));
  }, []);
  useEffect(() => {
    const f = () => setRoute(parseHash());
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  const refreshClubs = useCallback(() => api("clubs").then(setClubs).catch(() => {}), []);
  useEffect(() => {
    if (user && user.role === "ADMIN" && !user.must_change_password) refreshClubs();
  }, [user, refreshClubs]);
  useEffect(() => {
    const k = (e) => {
      if (e.key === "/" && user && !search && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); setSearch(true); }
      if (e.key === "Escape") { setSearch(false); setMenu(null); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [user, search]);

  const go = useCallback((name, arg) => { window.location.hash = name + (arg != null && arg !== "" ? "/" + encodeURIComponent(arg) : ""); const m = document.querySelector(".main"); if (m) m.scrollTop = 0; }, []);
  const back = useCallback(() => { if (window.history.length > 1) window.history.back(); else go(""); }, [go]);

  if (booting) return <div className="app"><Loading /></div>;
  if (!user) {
    return (
      <div className="app"><Login onLogin={(u, portal) => {
        if (u.role === "ADMIN") {
          const own = u.owned_clubs || [];
          const next = portal === "club" && own.length ? String(own[0].id) : "admin";
          setWs(next); store.set("sww_ws", next);
        }
        setUser(u); go("");
      }} /></div>
    );
  }
  if (user.must_change_password) {
    return <div className="app"><ChangePassword forced user={user} onDone={(u) => setUser(u)} onLogout={logoutLocal} /></div>;
  }

  const role = user.role, isAdmin = role === "ADMIN";
  const owned = user.owned_clubs || [];
  // Club Owners and Supervisors always work in their own club. The Super Admin picks a workspace.
  const curWs = isAdmin ? (ws === "admin" || clubs.some((c) => String(c.id) === ws) || owned.some((c) => String(c.id) === ws) ? ws : "admin") : String(user.club);
  const inClub = curWs !== "admin";
  const club = inClub ? curWs : "";
  const clubRec = isAdmin ? (clubs.find((c) => String(c.id) === club) || owned.find((c) => String(c.id) === club)) : { id: user.club, name: user.club_name };
  const clubName = clubRec ? clubRec.name : "";
  const mine = owned.some((c) => String(c.id) === club);
  const switchWs = (to) => { setWs(to); store.set("sww_ws", to); setMenu(null); setClubQ(""); go(""); };
  const ctx = { user, role, isAdmin, inClub, club, clubName, clubs, go, back, refreshClubs, setUser, switchWs, mine, openSearch: () => setSearch(true) };

  const pages = inClub ? CLUB_PAGES : ADMIN_PAGES;
  const def = inClub ? "home" : "overview";
  let name = pages[route.name] ? route.name : def;
  if (role === "SUPERVISOR" && name === "tree") name = def;
  const [, Page] = pages[name];

  const nav = inClub
    ? [["home", "Home", "home"], ["desk", "Coupon desk", "desk"], ["customers", "Customers", "users"], ["referrals", "Referrals", "ref"],
       ["trials", "Trials & CVC", "trial"], ["coaches", "Coaches", "coach"]]
    : [["overview", "Overview", "home"], ["clubs", "Clubs", "clubs"], ["coupons", "Coupons", "coupon"], ["resets", "Resets", "key"],
       ["import", "Import", "upload"], ["audit", "Activity", "log"]];
  const sideMore = inClub ? [["weekly", "Weekly results", "award"], ...(role !== "SUPERVISOR" ? [["tree", "Referral trees", "tree"]] : [])] : [];
  const tabs = inClub ? [...nav.filter((n) => !["trials", "coaches"].includes(n[0])), ["more", "More", "grid"]]
    : [...nav.filter((n) => ["overview", "clubs", "coupons", "resets"].includes(n[0])), ["more", "More", "grid"]];
  const rootOf = { club: "clubs", allocate: "coupons", customer: "customers", cvc: "trials", weekly: inClub ? "weekly" : "", password: "" };
  const active = rootOf[name] !== undefined ? rootOf[name] : name;
  const inTabs = tabs.some((n) => n[0] === active);
  const isOn = (k, list) => active === k || (list === tabs && k === "more" && !inTabs && active !== "");
  const navBtns = (list) => list.map(([k, label, ic]) => (
    <button key={k} className={"navb" + (isOn(k, list) ? " on" : "")} onClick={() => go(k)}>
      <Icon name={ic} size={20} /><span>{label}</span>
    </button>
  ));

  const otherClubs = clubs.filter((c) => c.is_active && !owned.some((o) => o.id === c.id) && (!clubQ || (c.name + c.city).toLowerCase().includes(clubQ.toLowerCase())));
  const wsLabel = inClub
    ? <><span className={"dot " + (mine || !isAdmin ? "club" : "other")}>{initials(clubName)}</span><span className="t"><b>{clubName || "Club"}</b><i>{!isAdmin ? (role === "OWNER" ? "Club Owner" : "Supervisor") : mine ? "You are the Owner" : "Super Admin view"}</i></span></>
    : <><span className="dot admin">SA</span><span className="t"><b>Admin console</b><i>All {clubs.length} clubs</i></span></>;

  return (
    <div className="app">
      <header className="top">
        <div className="logo"><Icon name="leaf" size={26} color="#B48A2C" width={1.4} /><span>SHREYAS</span></div>
        {isAdmin
          ? <button className="ws" aria-haspopup="menu" aria-expanded={menu === "ws"} onClick={() => setMenu(menu === "ws" ? null : "ws")}>{wsLabel}<Icon name="down" size={16} /></button>
          : <div className="ws static">{wsLabel}</div>}
        <div className="sp" />
        <button className="sbtn" onClick={() => setSearch(true)} aria-label="Search customers, referrals and coaches"><Icon name="search" size={18} /><span className="lbl2">Search customers, referrals, coaches</span><kbd>/</kbd></button>
        <button className="avatar" aria-label="Account" aria-haspopup="menu" onClick={() => setMenu(menu === "me" ? null : "me")}>{initials(user.first_name ? user.first_name + " " + user.last_name : user.username)}</button>
      </header>
      {menu === "ws" && (
        <div className="menu left" role="menu">
          <div className="h">Workspace</div>
          <button className={curWs === "admin" ? "on" : ""} onClick={() => switchWs("admin")}><span className="dot admin" style={{ width: 30, height: 30, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600 }}>SA</span><span className="t"><b>Admin console</b><i>Every club, coupons, logins</i></span></button>
          {owned.length > 0 && <div className="h">My club{owned.length > 1 ? "s" : ""}</div>}
          {owned.map((c) => (
            <button key={c.id} className={curWs === String(c.id) ? "on" : ""} onClick={() => switchWs(String(c.id))}><span className="dot club" style={{ width: 30, height: 30, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600 }}>{initials(c.name)}</span><span className="t"><b>{c.name}</b><i>You are the Owner</i></span></button>
          ))}
          <div className="h">Work in another club</div>
          {clubs.filter((c) => c.is_active).length > 6 && <input className="inp" placeholder="Find a club" value={clubQ} onChange={(e) => setClubQ(e.target.value)} aria-label="Find a club" />}
          {otherClubs.slice(0, 30).map((c) => (
            <button key={c.id} className={curWs === String(c.id) ? "on" : ""} onClick={() => switchWs(String(c.id))}><span className="dot other" style={{ width: 30, height: 30, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600 }}>{initials(c.name)}</span><span className="t"><b>{c.name}</b><i>{c.city}{c.owner ? " · " + c.owner : ""}</i></span></button>
          ))}
          {owned.length === 0 && <p className="muted" style={{ padding: "6px 10px 10px" }}>Run a club yourself? Open it in Clubs and choose "I run this club".</p>}
        </div>
      )}
      {menu === "me" && (
        <div className="menu right" role="menu">
          <div className="h">{user.first_name || user.username}</div>
          <button onClick={() => { setMenu(null); go("password"); }}><Icon name="key" size={18} /><span className="t"><b>Change password</b></span></button>
          <button onClick={() => { setMenu(null); api("auth/logout", { method: "POST" }).catch(() => {}); logoutLocal(); }}><Icon name="out" size={18} /><span className="t"><b>Log out</b></span></button>
        </div>
      )}
      {menu && <div style={{ position: "absolute", inset: "64px 0 0", zIndex: 30 }} onClick={() => setMenu(null)} />}
      <div className="body">
        <nav className="side" aria-label="Main">
          {navBtns(nav)}
          {sideMore.length > 0 && <><p className="sub">Programs</p>{navBtns(sideMore)}</>}
        </nav>
        <main className="main"><div className="content">
          {!SELF_TITLED.includes(name) && (
            <div className="head"><div>
              {["club", "customer", "allocate", "password"].includes(name) && <button className="linkbtn" onClick={back} style={{ display: "flex", alignItems: "center", gap: 4 }}><Icon name="back" size={16} />Back</button>}
              <p className="eyebrow">{inClub ? clubName : "Admin console"}</p><h1 className="pg">{pages[name][0]}</h1>
            </div></div>
          )}
          <Page ctx={ctx} arg={route.arg} key={name + (route.arg || "") + curWs} user={user} onDone={() => back()} />
        </div></main>
      </div>
      <nav className="tabs" aria-label="Main">{navBtns(tabs)}</nav>
      {search && <SearchOverlay ctx={ctx} onClose={() => setSearch(false)} />}
    </div>
  );
}
