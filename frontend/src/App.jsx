import { useCallback, useEffect, useState } from "react";
import { api, hasToken, setToken, setUnauthorizedHandler } from "./api";
import { Icon, Loading, ToastProvider } from "./ui";
import { ChangePassword, Login } from "./screens/Auth";
import { AdminHome, Allocate, AuditLog, ClubDetail, Clubs, Coupons, ImportExcel, Resets } from "./screens/Admin";
import { Customer, Customers } from "./screens/Customers";
import { Issue } from "./screens/Issue";
import { Visits } from "./screens/Visits";
import { Coaches, Cvc, Launch, More, OwnerHome, Tree, Trials, Weekly } from "./screens/Club";

const TITLES = {
  home: "Dashboard", clubs: "Nutrition clubs", club: "Club details", coupons: "Coupon inventory", allocate: "Allocate coupons",
  resets: "Password resets", audit: "Change log", import: "Import from Excel", customers: "Customers", customer: "Customer", issue: "Issue coupon",
  visits: "Visitors & redemption", more: "More", trials: "3-day trials", cvc: "CVC membership", weekly: "Weekly results",
  coaches: "Wellness coaches", tree: "Referral trees", password: "Change password",
};
const CLUB_SCREENS = ["customers", "customer", "issue", "visits", "trials", "cvc", "weekly", "coaches", "tree"];

function parseHash() {
  const h = (window.location.hash || "").replace(/^#/, "");
  const [name, arg] = h.split("/");
  return { name: name || "home", arg: arg || null };
}

export default function App() {
  return <ToastProvider><Shell /></ToastProvider>;
}

function Shell() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(hasToken());
  const [route, setRoute] = useState(parseHash());
  const [adminClub, setAdminClub] = useState(() => { try { return localStorage.getItem("sww_club") || ""; } catch (e) { return ""; } });
  const [clubs, setClubs] = useState([]);

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
  useEffect(() => {
    if (user && user.role === "ADMIN" && !user.must_change_password) api("clubs").then(setClubs).catch(() => {});
  }, [user]);

  const go = useCallback((name, arg) => { window.location.hash = name + (arg ? "/" + arg : ""); window.scrollTo(0, 0); }, []);
  const back = useCallback(() => { if (window.history.length > 1) window.history.back(); else go("home"); }, [go]);
  const pickClub = (id) => { setAdminClub(id); try { localStorage.setItem("sww_club", id); } catch (e) { /* ignore */ } };

  if (booting) return <div className="app"><Loading /></div>;
  if (!user) return <div className="app"><Login onLogin={(u) => { setUser(u); go("home"); }} /></div>;
  if (user.must_change_password) {
    return <div className="app"><ChangePassword forced user={user} onDone={(u) => setUser(u)} onLogout={logoutLocal} /></div>;
  }

  const role = user.role, isAdmin = role === "ADMIN";
  const club = isAdmin ? adminClub : String(user.club);
  const clubName = isAdmin ? (clubs.find((c) => String(c.id) === String(adminClub)) || {}).name : user.club_name;
  const ctx = { user, role, isAdmin, club, clubName, clubs, go, back, refreshClubs: () => api("clubs").then(setClubs), setUser };

  const name = TITLES[route.name] ? route.name : "home";
  const nav = isAdmin
    ? [["home", "Home", "home"], ["clubs", "Clubs", "clubs"], ["coupons", "Coupons", "coupon"], ["resets", "Resets", "key"], ["more", "More", "grid"]]
    : role === "OWNER"
      ? [["home", "Home", "home"], ["customers", "Customers", "users"], ["issue", "Issue", "coupon"], ["visits", "Visits", "door"], ["more", "More", "grid"]]
      : [["home", "Home", "home"], ["issue", "Issue", "coupon"], ["visits", "Visits", "door"], ["customers", "Customers", "users"], ["more", "More", "grid"]];
  const sideExtra = isAdmin
    ? [["import", "Import from Excel", "upload"], ["customers", "Customers", "users"], ["issue", "Issue coupon", "coupon"], ["visits", "Visitors", "door"], ["trials", "3-day trials", "trial"], ["cvc", "CVC", "star"], ["weekly", "Weekly results", "award"], ["coaches", "Coaches", "coach"], ["tree", "Referral trees", "tree"], ["audit", "Change log", "log"]]
    : [["trials", "3-day trials", "trial"], ["cvc", "CVC membership", "star"], ["weekly", "Weekly results", "award"], ["coaches", "Coaches", "coach"], ...(role === "OWNER" ? [["tree", "Referral trees", "tree"]] : [])];
  const roleLabel = isAdmin ? "SUPER ADMIN" + (clubName ? " · " + clubName.toUpperCase() : " · ALL CLUBS") : (role === "OWNER" ? "CLUB OWNER · " : "SUPERVISOR · ") + (user.club_name || "").toUpperCase();
  const rootOf = { club: "clubs", allocate: "coupons", customer: "customers" };
  const active = rootOf[name] || name;
  const showBack = ["club", "allocate", "customer", "password"].includes(name) || (!nav.some((n) => n[0] === name) && name !== "home");

  const navBtns = (list) => list.map(([k, label, ic]) => (
    <button key={k} className={"navb" + (active === k ? " on" : "")} onClick={() => go(k)}>
      <Icon name={ic} size={k === "home" || list === nav ? 22 : 20} /><span>{label}</span>
    </button>
  ));

  let body;
  const needsClub = isAdmin && CLUB_SCREENS.includes(name) && !club;
  if (needsClub) body = <PickClubFirst clubs={clubs} onPick={pickClub} />;
  else if (role === "SUPERVISOR" && (name === "tree")) body = <p className="muted">Referral trees are for the Club Owner and Super Admin.</p>;
  else {
    const S = {
      home: isAdmin ? AdminHome : role === "OWNER" ? OwnerHome : Launch,
      clubs: Clubs, club: ClubDetail, coupons: Coupons, allocate: Allocate, resets: Resets, audit: AuditLog, import: ImportExcel,
      customers: Customers, customer: Customer, issue: Issue, visits: Visits, more: More, trials: Trials, cvc: Cvc,
      weekly: Weekly, coaches: Coaches, tree: Tree, password: ChangePassword,
    }[name];
    const adminOnly = ["clubs", "club", "coupons", "allocate", "resets", "audit", "import"];
    body = adminOnly.includes(name) && !isAdmin ? <p className="muted">This page is for the Super Admin.</p>
      : <S ctx={ctx} arg={route.arg} key={name + (route.arg || "") + club} user={user} onDone={() => back()} />;
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brandmark"><Icon name="leaf" size={30} color="#D9B865" width={1.3} /><b>SHREYAS</b></div>
        {showBack && <button className="ibtn" aria-label="Back" onClick={back}><Icon name="back" /></button>}
        <div className="t"><b>{TITLES[name]}</b><span>{roleLabel}</span></div>
        {isAdmin && (
          <select className="clubpick" aria-label="Club" value={adminClub} onChange={(e) => pickClub(e.target.value)}>
            <option value="">All clubs</option>
            {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_active ? "" : " (disabled)"}</option>)}
          </select>
        )}
        <button className="ibtn" aria-label="Log out" onClick={() => { api("auth/logout", { method: "POST" }).catch(() => {}); logoutLocal(); }}><Icon name="out" size={20} /></button>
      </header>
      <div className="body">
        <nav className="side" aria-label="Main">
          {navBtns(nav.filter((n) => n[0] !== "more"))}
          <p className="sub">{isAdmin ? "Club work" + (clubName ? " · " + clubName : "") : "Programs"}</p>
          {navBtns(sideExtra)}
          <button className={"navb" + (name === "password" ? " on" : "")} onClick={() => go("password")}><Icon name="key" size={20} /><span>Change password</span></button>
        </nav>
        <main className="main"><div className="content">{body}</div></main>
      </div>
      <nav className="tabs" aria-label="Main">{navBtns(nav)}</nav>
    </div>
  );
}

function PickClubFirst({ clubs, onPick }) {
  return (
    <div className="card" style={{ maxWidth: 520 }}>
      <p className="h2">Choose a club</p>
      <p className="muted">Customer, coupon and visit records belong to one club. Pick which club you want to work in.</p>
      {clubs.filter((c) => c.is_active).map((c) => (
        <button key={c.id} className="row" onClick={() => onPick(String(c.id))}><span className="grow"><b>{c.name}</b><span className="muted">{c.city}</span></span><Icon name="chev" size={18} /></button>
      ))}
    </div>
  );
}
