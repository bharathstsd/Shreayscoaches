import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { copyText, Field, fmtDate, Icon, Loading, Sheet, useAction, useLoad, useToast } from "../ui";
import { CoachForm } from "./Club";
import { CustomerForm } from "./Customers";
import { greet } from "./Admin";

// ------------------------------------------------------------------ small parts
const RANGES = [["today", "Today"], ["d7", "7 days"], ["d30", "30 days"], ["month", "This month"], ["all", "All time"]];
const rangeLabel = (k) => (RANGES.find((r) => r[0] === k) || RANGES[2])[1];
const STAGE_PILL = { New: "grey", Visitor: "gold", "In trial": "warn", "Trial done": "warn", "CVC member": "good" };
const REF_PILL = { Waiting: "gold", "Friend registered": "gold", "Day 1 done": "warn", "Day 2 done": "good", Expired: "bad", Paused: "grey" };
const store = { get: (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } } };
const dshort = (iso) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "");
const mob = (m) => (m && m.length === 10 ? m.slice(0, 5) + " " + m.slice(5) : m || "");

function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function Hl({ text, q }) {
  const t = String(text || "");
  const s = (q || "").trim().replace(/^#/, "");
  if (!s) return t;
  const i = t.toLowerCase().indexOf(s.toLowerCase());
  if (i >= 0) return <>{t.slice(0, i)}<mark>{t.slice(i, i + s.length)}</mark>{t.slice(i + s.length)}</>;
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 3 && t.replace(/\D/g, "").includes(digits)) return <mark>{t}</mark>;
  return t;
}

function Spark({ data, color }) {
  const w = 160, h = 34;
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const pts = data.map((v, i) => [i * (w / Math.max(1, data.length - 1)), h - 3 - ((v - min) / ((max - min) || 1)) * (h - 8)]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`${d} L${w} ${h} L0 ${h} Z`} fill={color} fillOpacity=".09" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill={color} />
    </svg>
  );
}

function Ring({ value, color = "#0F3B32" }) {
  const r = 34, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, value));
  return (
    <svg width="86" height="86" viewBox="0 0 86 86" aria-hidden="true">
      <circle cx="43" cy="43" r={r} fill="none" stroke="#EFEBE2" strokeWidth="9" />
      <circle cx="43" cy="43" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(c * f).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90 43 43)" />
    </svg>
  );
}

function RangeChips({ value, onChange }) {
  return <div className="chips scroll" role="group" aria-label="Period">{RANGES.map(([k, l]) => <button key={k} className={"chip" + (value === k ? " on" : "")} onClick={() => onChange(k)}>{l}</button>)}</div>;
}

function Kpis({ data }) {
  const items = [["Friends visited", "visits", "#0F3B32"], ["Completed Day 2", "d2", "#0F3B32"], ["Trials started", "trials", "#B48A2C"], ["CVC conversions", "cvc", "#B48A2C"]];
  return (
    <div className="kgrid">
      {items.map(([l, k, col]) => {
        const dlt = data.deltas ? data.deltas[k] : null;
        return (
          <div key={k} className="kc">
            <span className="l">{l}</span>
            <span className="v num">{data.kpis[k]}</span>
            <span className="d">{data.range === "all" ? "Since launch" : dlt == null ? "No earlier data to compare" : <><span className={dlt >= 0 ? "up" : "down"}>{dlt >= 0 ? "▲" : "▼"} {Math.abs(dlt)}%</span> vs previous {rangeLabel(data.range).toLowerCase()}</>}</span>
            <Spark data={data.spark[k]} color={col} />
          </div>
        );
      })}
    </div>
  );
}

function Funnel({ rows }) {
  const top = Math.max(rows[0][1], 1);
  return (
    <div className="fun">
      {rows.map(([l, n], i) => (
        <div key={l} className={"r" + (i >= 4 ? " cv" : "")}>
          <span>{l}</span>
          <span className="bar"><i style={{ width: (n ? Math.max(2, Math.round(n / top * 100)) : 0) + "%" }} /></span>
          <span className="n num">{n}{i > 0 && <span className="p">{rows[i - 1][1] ? Math.round(n / rows[i - 1][1] * 100) + "%" : "—"}</span>}</span>
        </div>
      ))}
    </div>
  );
}

function Inviters({ list, ctx }) {
  if (!list.length) return <p className="muted">No friends have visited in this period yet.</p>;
  return list.map((t) => (
    <div key={t.id} className="lrow">
      <span className="t"><b style={{ fontWeight: 500 }}>{t.name}</b>{t.club && <i>{t.club}</i>}</span>
      <span className="small num" style={{ textAlign: "right", fontSize: 13 }}><b>{t.friends}</b> friend{t.friends > 1 ? "s" : ""}<br /><span className="muted">{t.converted} converted</span></span>
    </div>
  ));
}

// ------------------------------------------------------------------ search
export function SearchOverlay({ ctx, onClose }) {
  const [q, setQ] = useState("");
  const [scope, setScope] = useState("all");
  const dq = useDebounced(q.trim(), 200);
  const [res, setRes] = useState(null);
  const inp = useRef();
  useEffect(() => { inp.current && inp.current.focus(); }, []);
  useEffect(() => {
    if (dq.length < 2) { setRes(null); return; }
    let live = true;
    api("search?q=" + encodeURIComponent(dq), { club: ctx.club || undefined }).then((r) => live && setRes(r)).catch(() => live && setRes({ customers: [], referrals: [], coaches: [], counts: {} }));
    return () => { live = false; };
  }, [dq, ctx.club]);
  const open = (clubId, page, arg) => {
    onClose();
    if (!ctx.inClub && ctx.isAdmin && clubId) { ctx.switchWs(String(clubId)); setTimeout(() => ctx.go(page, arg), 0); }
    else ctx.go(page, arg);
  };
  const show = (k) => scope === "all" || scope === k;
  const lim = scope === "all" ? 4 : 8;
  const Sec = ({ k, title, list, render }) => (show(k) && list && list.length ? <><div className="h"><span>{title}</span><span>{res.counts[k]}</span></div>{list.slice(0, lim).map(render)}</> : null);
  const nothing = res && !res.customers.length && !res.referrals.length && !res.coaches.length;
  return (
    <div className="sover" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sbox" role="dialog" aria-label="Search">
        <div className="in"><Icon name="search" size={20} color="#66746E" /><input ref={inp} id="gq" placeholder="Name, mobile, coupon number or Herbalife ID" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" aria-label="Search" /><button className="chip" onClick={onClose}>Esc</button></div>
        <div className="scope" role="group" aria-label="Search in">
          {[["all", "Everything"], ["customers", "Customers"], ["referrals", "Referrals"], ["coaches", "Coaches"]].map(([k, l]) => <button key={k} className={"chip" + (scope === k ? " on" : "")} onClick={() => { setScope(k); inp.current.focus(); }}>{l}</button>)}
          <span className="muted" style={{ marginLeft: "auto" }}>{ctx.inClub ? ctx.clubName : "All clubs"}</span>
        </div>
        <div className="sres">
          {!res && <p className="muted" style={{ padding: 12 }}>Type at least 2 letters. Searches names, any part of a mobile number, coupon numbers (e.g. #35) and Herbalife IDs.</p>}
          {nothing && <div className="empty"><b>Nothing matches "{dq}"</b><br />Check the spelling or try part of the mobile number.</div>}
          {res && <>
            <Sec k="customers" title="Customers" list={res.customers} render={(c) => (
              <button key={"c" + c.id} className="hit" onClick={() => open(c.club_id, "customer", c.id)}><span className="av">{(c.name || "?").slice(0, 1)}</span><span className="t"><b><Hl text={c.name} q={dq} /></b><i><Hl text={mob(c.mobile)} q={dq} />{c.coach ? " · " + c.coach : ""}{c.club ? " · " + c.club : ""}</i></span><span className={"pill " + STAGE_PILL[c.stage]}>{c.stage}</span></button>
            )} />
            <Sec k="referrals" title="Referrals" list={res.referrals} render={(r) => (
              <button key={"r" + r.id} className="hit" onClick={() => open(r.club_id, "desk", r.number)}><span className="av r"><Icon name="coupon" size={16} /></span><span className="t"><b><Hl text={r.coupon} q={dq} /></b><i><Hl text={r.holder} q={dq} />{r.visitor ? <> → <Hl text={r.visitor} q={dq} /></> : " · waiting for a friend"}{r.club ? " · " + r.club : ""}</i></span><span className={"pill " + REF_PILL[r.status]}>{r.status}</span></button>
            )} />
            <Sec k="coaches" title="Coaches" list={res.coaches} render={(c) => (
              <button key={"k" + c.id} className="hit" onClick={() => open(c.club_id, "coaches", c.name)}><span className="av c"><Icon name="coach" size={16} /></span><span className="t"><b><Hl text={c.name} q={dq} /></b><i><Hl text={c.herbalife_id} q={dq} /> · <Hl text={mob(c.mobile)} q={dq} />{c.club ? " · " + c.club : ""}</i></span>{!c.is_active && <span className="pill grey">Inactive</span>}</button>
            )} />
          </>}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Admin overview
export function AdminOverview({ ctx }) {
  const [range, setRange] = useState(() => store.get("sww_range", "d30"));
  const { data, error } = useLoad(`dash?range=${range}`);
  const pick = (k) => { setRange(k); store.set("sww_range", k); };
  if (error) return <p className="err">{error}</p>;
  const first = (ctx.user.first_name || ctx.user.username);
  return (
    <>
      <div className="head"><div><p className="eyebrow">Network · {rangeLabel(range)}</p><h1 className="pg">Good {greet()}, {first}</h1></div><RangeChips value={range} onChange={pick} /></div>
      {!data ? <Loading /> : <>
        {data.attention.length > 0 && (
          <div className="att">
            {data.attention.map((a, i) => (
              <button key={i} className={"attc " + (a.level === "bad" ? "bad" : a.level === "info" ? "info" : "")}
                onClick={() => a.kind === "resets" ? ctx.go("resets") : a.kind === "stock" ? ctx.go("allocate", a.club) : a.kind === "start_many" ? ctx.go("clubs") : ctx.go("club", a.club)}>
                <Icon name={a.kind === "resets" ? "key" : a.kind === "stock" ? "coupon" : a.kind.startsWith("start") ? "users" : "alert"} size={20} color={a.level === "bad" ? "#9B3530" : a.level === "info" ? "#0F5B48" : "#9A6A12"} />
                <span><b>{a.title}</b><span>{a.text}</span></span>
              </button>
            ))}
          </div>
        )}
        <Kpis data={data} />
        <div className="g2">
          <section className="panel">
            <div className="head"><h2 className="sec">Club ranking</h2><span className="muted">Ranked by trial → CVC</span></div>
            {data.clubs.length === 0 ? <p className="muted">No clubs yet. Add one in Clubs or Import from Excel.</p> : (
              <div className="tw"><table><thead><tr><th /><th>Club</th><th className="r">Visits</th><th className="r">Day 2</th><th className="r">CVC</th><th>Trial → CVC</th><th className="r">Stock</th></tr></thead><tbody>
                {data.clubs.map((c, i) => (
                  <tr key={c.id} className="click" onClick={() => ctx.go("club", c.id)}>
                    <td><span className={"rank" + (i < 3 && c.conversion != null ? " g" : "")}>{i + 1}</span></td>
                    <td><b style={{ fontWeight: 500 }}>{c.name}</b> {!c.is_active && <span className="pill bad">Disabled</span>}<br /><span className="muted">{[c.city, c.mine ? "your club" : c.owner || "no owner yet"].filter(Boolean).join(" · ")}</span></td>
                    <td className="r num">{c.visits}</td><td className="r num">{c.d2}</td><td className="r num">{c.cvc}</td>
                    <td><span className="mb"><span className="bar2"><i style={{ width: (c.conversion || 0) + "%" }} /></span><span className="num" style={{ fontSize: 13 }}>{c.conversion == null ? "—" : c.conversion + "%"}</span></span></td>
                    <td className="r">{c.stock < 20 && c.is_active ? <span className="pill bad">{c.stock}</span> : <span className="num">{c.stock}</span>}</td>
                  </tr>
                ))}
              </tbody></table></div>
            )}
          </section>
          <section className="panel"><h2 className="sec">Network funnel</h2><Funnel rows={data.funnel} /><p className="muted">Each percentage compares a step with the one above it.</p></section>
        </div>
        <div className="g3">
          <section className="panel"><p className="eyebrow">Coupon inventory</p>
            <div className="gauge"><Ring value={data.inventory.printed ? (data.inventory.printed - data.inventory.free) / data.inventory.printed : 0} /><div><div className="bn num">{data.inventory.printed.toLocaleString("en-IN")}</div><span className="muted">printed in {data.inventory.batches} batch{data.inventory.batches === 1 ? "" : "es"}</span></div></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
              <div className="lrow"><span>With clubs, not issued</span><b className="num">{data.inventory.with_clubs}</b></div>
              <div className="lrow"><span>Issued to customers</span><b className="num">{data.inventory.issued}</b></div>
              <div className="lrow"><span>Not allocated yet</span><b className="num">{data.inventory.free}</b></div>
            </div>
            <button className="btn ghost sm" onClick={() => ctx.go("coupons")}>Manage coupons</button>
          </section>
          <section className="panel"><p className="eyebrow">Top inviters</p><Inviters list={data.top_inviters} ctx={ctx} /></section>
          <section className="panel"><p className="eyebrow">Club Owner logins · last 7 days</p>
            <div className="gauge"><div className="bn num">{data.logins.seen}<span style={{ fontSize: 22, color: "var(--faint)" }}> / {data.logins.total}</span></div><span className="muted">active clubs whose Owner logged in</span></div>
            <button className="btn ghost sm" onClick={() => ctx.go("audit")}>See login activity</button>
          </section>
        </div>
      </>}
    </>
  );
}

// ------------------------------------------------------------------ Club home
export function ClubHome({ ctx }) {
  const [range, setRange] = useState(() => store.get("sww_range", "d30"));
  const supervisor = ctx.role === "SUPERVISOR";
  const { data, error, reload } = useLoad(supervisor ? null : `dash?range=${range}`, { club: ctx.club });
  const pick = (k) => { setRange(k); store.set("sww_range", k); };
  if (supervisor) {
    return (<>
      <div><p className="eyebrow">{ctx.clubName}</p><h1 className="pg">Good {greet()}, {ctx.user.first_name || ctx.user.username}</h1></div>
      <Desk ctx={ctx} />
    </>);
  }
  if (error) return <p className="err">{error}</p>;
  const title = ctx.isAdmin && !ctx.mine ? ctx.clubName : "Your club today";
  return (
    <>
      <div className="head"><div><p className="eyebrow">{ctx.clubName} · {rangeLabel(range)}</p><h1 className="pg">{title}</h1></div><RangeChips value={range} onChange={pick} /></div>
      {data && !data.setup_done && <Setup ctx={ctx} steps={data.setup} />}
      <Desk ctx={ctx} onChange={reload} />
      {!data ? <Loading /> : <>
        <div className="g2">
          <TodayPanel ctx={ctx} t={data.today} />
          <section className="panel"><h2 className="sec">This period</h2><Funnel rows={data.funnel} /></section>
        </div>
        <Kpis data={data} />
        <div className="g3">
          <section className="panel"><p className="eyebrow">Coupon stock</p>
            <div className="gauge"><Ring value={Math.min(1, data.stock.stock / Math.max(50, data.stock.issued_30 * 2))} color="#B48A2C" /><div><div className="bn num">{data.stock.stock}</div><span className="muted">left{data.stock.days_left != null ? ` · about ${data.stock.days_left} days at this pace` : ""}</span></div></div>
            <div className="muted">{data.stock.batches.map((b) => `${b.batch} #${b.first} – #${b.last}`).join(" · ") || "No coupons yet. The Super Admin allocates a range."}{data.stock.valid_days.length ? ` · valid ${data.stock.valid_days.join(" / ")} days after issue` : ""}</div>
          </section>
          <section className="panel"><p className="eyebrow">Coach ranking</p>
            {data.coaches.length === 0 ? <p className="muted">No coaches yet.</p> : data.coaches.slice(0, 6).map((c, i) => (
              <div key={c.id} className="lrow"><span className={"rank" + (i === 0 && c.cvc ? " g" : "")}>{i + 1}</span><span className="t"><b style={{ fontWeight: 500 }}>{c.name}</b><i>{c.issued} coupons · {c.trials} trials</i></span><span className={"pill " + (c.cvc ? "good" : "grey")}>{c.cvc} CVC</span></div>
            ))}
          </section>
          <section className="panel"><p className="eyebrow">Top inviters</p><Inviters list={data.top_inviters} ctx={ctx} /><button className="btn ghost sm" onClick={() => ctx.go("tree")}>See referral trees</button></section>
        </div>
      </>}
    </>
  );
}

function Setup({ ctx, steps }) {
  const done = steps.filter((s) => s.done).length;
  const act = { coach: ["Add coach", () => ctx.go("coaches")], stock: ctx.isAdmin ? ["Allocate", () => { ctx.switchWs("admin"); setTimeout(() => ctx.go("allocate", ctx.club), 0); }] : null,
    owner: ctx.isAdmin ? ["Open club", () => { ctx.switchWs("admin"); setTimeout(() => ctx.go("club", ctx.club), 0); }] : null };
  return (
    <section className="panel">
      <div className="head"><h2 className="sec">Set up {ctx.clubName}</h2><span className="muted">{done} of {steps.length} done</span></div>
      <div className="progress"><i style={{ width: (done / steps.length * 100) + "%" }} /></div>
      <div>
        {steps.map((s) => (
          <div key={s.key} className={"ck" + (s.done ? " done" : "")}>
            <span className="c">{s.done && <Icon name="check" size={14} color="#fff" width={2.4} />}</span>
            <span className="t"><b>{s.label}</b><i>{s.hint}</i></span>
            {!s.done && act[s.key] && <button className="btn ghost sm" onClick={act[s.key][1]}>{act[s.key][0]}</button>}
          </div>
        ))}
      </div>
    </section>
  );
}

function TodayPanel({ ctx, t }) {
  const items = [];
  t.d2_due.forEach((x) => items.push({ k: "d2" + x.customer, ic: "door", tone: "g", title: `${x.name} · Day 2 due`, sub: `${x.number ? "Coupon " + x.coupon : "Complimentary visit"} · Day 1 on ${dshort(x.day1)}`, btn: "Open", fn: () => ctx.go("customer", x.customer) }));
  t.trials.filter((x) => x.can_mark || x.tone === "bad").forEach((x) => items.push({ k: "t" + x.id, ic: "trial", tone: x.tone === "bad" ? "r" : "y", title: `${x.name} · ${x.label}`, sub: x.tone === "bad" ? "Call them to come back" : "Mark attendance when they arrive", btn: "Open", fn: () => ctx.go("customer", x.customer) }));
  (t.convert || []).forEach((x) => items.push({ k: "c" + x.customer, ic: "star", tone: "g", title: `${x.name} · ready for CVC`, sub: "Completed the 3-day trial", btn: "Convert", fn: () => ctx.go("customer", x.customer) }));
  if (t.weekly_due.count) items.push({ k: "w", ic: "scale", tone: "y", title: `${t.weekly_due.count} weekly check-up${t.weekly_due.count > 1 ? "s" : ""} due`, sub: t.weekly_due.names.join(", ") + (t.weekly_due.count > 4 ? "…" : ""), btn: "Record", fn: () => ctx.go("weekly") });
  if (t.expiring) items.push({ k: "e", ic: "alert", tone: "r", title: `${t.expiring} coupon${t.expiring > 1 ? "s" : ""} expire this week`, sub: "Issued, but no friend has visited yet", btn: "See", fn: () => ctx.go("referrals", "Waiting") });
  return (
    <section className="panel">
      <div className="head"><h2 className="sec">Today</h2><span className="muted">{new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</span></div>
      {items.length === 0 ? <p className="muted">Nothing waiting. Day 2 visits, trial attendance, weekly check-ups and expiring coupons will show up here.</p> : (
        <div>{items.slice(0, 8).map((i) => (
          <div key={i.k} className="td"><span className={"ic " + i.tone}><Icon name={i.ic} size={18} /></span><span className="t"><b>{i.title}</b><i>{i.sub}</i></span><button className="btn ghost sm" onClick={i.fn}>{i.btn}</button></div>
        ))}{items.length > 8 && <p className="muted">and {items.length - 8} more</p>}</div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ Coupon desk
export function DeskPage({ ctx, arg }) {
  return (<>
    <div><p className="eyebrow">{ctx.clubName}</p><h1 className="pg">Coupon desk</h1></div>
    <Desk ctx={ctx} initial={arg} big />
  </>);
}

function Desk({ ctx, initial, onChange }) {
  const preset = initial && String(initial).startsWith("c") ? String(initial).slice(1) : null;   // "c12" = issuing to customer 12
  const [num, setNum] = useState(preset ? "" : initial || "");
  const [hint, setHint] = useState(null);
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [flash, setFlash] = useState(null);
  const inp = useRef();
  async function lookup(n, batch) {
    const clean = String(n || "").replace(/\D/g, "");
    if (!clean) { setErr("Type the number printed on the coupon."); return; }
    setErr(""); setLoading(true);
    try { setD(await api(`desk?number=${clean}${batch ? "&batch=" + batch : ""}`, { club: ctx.club })); }
    catch (e) { setErr(e.message); setD(null); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    if (preset) {
      api("desk/next", { club: ctx.club }).then((x) => { if (x.number) { setNum(String(x.number)); setHint(x); } }).catch(() => {});
      api(`customers/${preset}`, { club: ctx.club }).then((c) => setHint((h) => ({ ...(h || {}), customer: c }))).catch(() => {});
      setTimeout(() => inp.current && inp.current.focus(), 0);
    } else if (initial) lookup(initial);
    /* eslint-disable-next-line */
  }, []);
  const refresh = (msg) => { setFlash(msg || null); lookup(d.number, d.batch).then(() => onChange && onChange()); };
  const reset = () => { setD(null); setNum(""); setFlash(null); setTimeout(() => inp.current && inp.current.focus(), 0); };
  return (
    <>
      <section className="desk">
        <p className="eyebrow">Coupon desk</p>
        <h2>Type the number on the coupon in front of you</h2>
        <form className="deskin" onSubmit={(e) => { e.preventDefault(); setFlash(null); lookup(num); }}>
          <label className="pre" htmlFor="dn"><span>#</span><input ref={inp} id="dn" inputMode="numeric" placeholder="e.g. 35" value={num} onChange={(e) => setNum(e.target.value)} autoComplete="off" aria-label="Coupon number" /></label>
          <button className="btn" disabled={loading}>{loading ? <span className="spin" /> : "Go"}</button>
        </form>
        {hint && hint.customer ? (
          <p className="hint" style={{ color: "#fff" }}>Issuing a coupon to <b>{hint.customer.name}</b>.{hint.number ? <> Next in stock: <b>{hint.label}</b>. Check it matches the leaflet, then tap Go.</> : " Type the number on the leaflet."}</p>
        ) : <p className="hint">Issue it, register the friend, record Day 1 and Day 2, or start the trial. The desk shows only the next step.</p>}
      </section>
      {err && <div className="alert bad">{err}</div>}
      {d && <section className="panel"><DeskResult ctx={ctx} d={d} flash={flash} refresh={refresh} reset={reset} choose={(b) => lookup(d.number, b)} preset={preset} /></section>}
    </>
  );
}

function Ticket({ d }) { return <div className="ctk" style={d.color ? { borderColor: d.color } : null}><i>{d.batch || ""}</i><b>#{d.number}</b></div>; }
function Steps({ done, now }) {
  const L = ["Issued", "Friend visits", "Day 1", "Day 2", "Trial", "CVC"];
  return <div className="steps">{L.map((l, i) => <span key={l} className={"step " + (i < done ? "done" : i === now ? "now" : "")}><span className="c">{i < done ? "✓" : i + 1}</span>{l}</span>)}</div>;
}

function DeskResult({ ctx, d, flash, refresh, reset, choose, preset }) {
  const [run, busy] = useAction();
  const [voiding, setVoiding] = useState(null);
  const [pausing, setPausing] = useState(false);
  const [reason, setReason] = useState("");
  const canFix = ctx.isAdmin || ctx.role === "OWNER";
  const body = (x) => ({ club: ctx.club, ...x });
  const call = (path, x, msg) => run(() => api(path, { method: "POST", club: ctx.club, body: body(x) }), msg);
  if (d.state === "missing") return <div className="alert bad"><b>#{d.number} isn't one of {ctx.clubName}'s coupons.</b> Check the number printed on the coupon.</div>;
  if (d.state === "other") return <div className="coupon"><Ticket d={d} /><div className="alert bad" style={{ flex: 1 }}><b>This coupon belongs to {d.club || "another club"}.</b> Coupons can be used only at the club that issued them.</div></div>;
  if (d.state === "choose") {
    return (<>
      <p className="big" style={{ margin: 0 }}>#{d.number} is in {d.choices.length} batches</p>
      <p className="muted">Check the batch code printed on the coupon and pick it.</p>
      <div className="pick">{d.choices.map((c) => <button key={c.batch_id} onClick={() => choose(c.batch_id)} style={{ borderLeft: "6px solid " + c.color }}><span className="t"><b>{c.batch}</b><i>#{d.number}</i></span><span className="pill grey">{c.status}</span></button>)}</div>
    </>);
  }
  if (d.state === "stock") return <IssueFlow ctx={ctx} d={d} reset={reset} preset={preset} />;

  const head = (pill, tone, title, sub) => (
    <div className="coupon"><Ticket d={d} /><div><span className={"pill " + tone} style={{ alignSelf: "flex-start" }}>{pill}</span><span className="big">{title}</span><span className="muted">{sub}</span></div></div>
  );
  const valid = d.expires_on ? `valid until ${fmtDate(d.expires_on)}` : "";
  const fix = (day) => { const r = (d.days || []).find((x) => x.day === day); return r && canFix ? <button className="linkbtn" onClick={() => setVoiding(r)}>Correct Day {day} (recorded by mistake)</button> : null; };
  let main;
  if (d.state === "waiting") {
    main = (<>
      {head("Waiting for a friend", "gold", `Given to ${d.holder} on ${dshort(d.issued_at)}`, `${d.purpose} · coach ${d.coach} · ${valid}`)}
      <Steps done={1} now={1} />
      <VisitForm ctx={ctx} d={d} onDone={(v) => refresh(`Welcome, ${v.visitor_name}! Day 1 recorded.`)} />
      {canFix && <div className="subtle"><button className="linkbtn" onClick={() => setPausing(true)}>Report lost (pause)</button>{d.can_undo && <button className="linkbtn" onClick={async () => { const r = await run(() => api(`issues/${d.issue}`, { method: "DELETE", club: ctx.club }), (x) => x.message); if (r) reset(); }}>Undo issue (back to stock)</button>}</div>}
    </>);
  } else if (d.state === "registered") {
    main = (<>
      {head("Friend registered", "gold", `${d.visitor}, invited by ${d.holder}`, valid)}
      <Steps done={2} now={2} />
      <button className="btn" disabled={busy} onClick={async () => { if (await call("redemptions", { visit: d.visit, day: 1 }, `Day 1 recorded for ${d.visitor}.`)) refresh(); }}>Record Day 1 for {d.visitor}</button>
    </>);
  } else if (d.state === "d1") {
    main = (<>
      {head(d.can_d2 ? "Day 2 due" : "Day 1 done", "gold", `${d.visitor}, invited by ${d.holder}`, `Day 1 ${dshort(d.days.find((x) => x.day === 1).at)} · ${valid}`)}
      <Steps done={3} now={3} />
      {d.paused ? <div className="alert warn">This coupon is paused{d.pause_reason ? ` (${d.pause_reason})` : ""}.</div>
        : d.can_d2 ? <button className="btn" disabled={busy} onClick={async () => { if (await call("redemptions", { visit: d.visit, day: 2 }, `Day 2 recorded. ${d.visitor} completed both visits.`)) refresh(); }}>Record Day 2 for {d.visitor}</button>
        : <button className="btn" disabled>Day 2 opens {fmtDate(d.d2_opens)}</button>}
      <div className="subtle">{fix(1)}</div>
    </>);
  } else if (d.state === "done") {
    const nx = d.next;
    main = (<>
      {head("Day 1 and Day 2 done", "good", `${d.visitor}, invited by ${d.holder}`, d.days.sort((a, b) => a.day - b.day).map((x) => `Day ${x.day} ${dshort(x.at)}`).join(" · "))}
      <Steps done={nx === "cvc" ? 6 : nx === "in_trial" || nx === "trial_done" ? 5 : 4} now={nx === "trial_done" ? 5 : 4} />
      {nx === "none" && <div className="rowflex"><button className="btn gold" disabled={busy} onClick={async () => { if (await call("trials", { customer: d.visitor_id }, `3-day trial started for ${d.visitor}.`)) refresh(); }}>Start 3-day trial for {d.visitor}</button><button className="btn ghost" onClick={reset}>Not now</button></div>}
      {nx === "trial_elsewhere" && <div className="alert info">Mobile {mob(d.visitor_mobile)} has already had a 3-day trial. One trial per mobile number.</div>}
      {nx === "in_trial" && <div className="rowflex"><span className="pill warn">Trial in progress</span><button className="btn ghost sm" onClick={() => ctx.go("trials")}>Mark attendance</button></div>}
      {nx === "trial_done" && <div className="rowflex"><span className="pill warn">Trial completed</span><button className="btn gold sm" onClick={() => ctx.go("cvc")}>Convert to CVC</button></div>}
      {nx === "cvc" && <span className="pill good" style={{ alignSelf: "flex-start" }}>CVC member</span>}
      <div className="subtle">{fix(2)}</div>
    </>);
  } else if (d.state === "expired") {
    main = (<>
      {head("Expired", "bad", `Given to ${d.holder} on ${dshort(d.issued_at)}. Expired on ${fmtDate(d.expires_on)}.`, `${d.batch} coupons are valid for ${d.valid_days} days after they're issued. An expired coupon can't be used for a visit.`)}
      {d.visitor && <p className="muted">Friend: {d.visitor}.</p>}
    </>);
  } else if (d.state === "paused") {
    main = (<>
      {head("Paused", "grey", `Given to ${d.holder} on ${dshort(d.issued_at)}`, `${d.pause_reason || "Reported lost"} · ${valid}`)}
      {canFix && <button className="btn ghost" disabled={busy} onClick={async () => { if (await call(`issues/${d.issue}`, {}, "Coupon active again.")) refresh(); }}>Resume this coupon</button>}
    </>);
  }
  return (
    <>
      {flash && <div className="alert good">{flash}</div>}
      {main}
      <button className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={reset}>Next coupon</button>
      {voiding && (
        <Sheet title={`Correct Day ${voiding.day} for ${d.visitor}`} onClose={() => setVoiding(null)}>
          <p className="muted">The original entry stays in history, marked as corrected. It no longer counts.</p>
          <Field label="Reason" id="vr" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. recorded for the wrong person" />
          <div className="btns"><button className="btn ghost" onClick={() => setVoiding(null)}>Cancel</button><button className="btn danger" disabled={!reason.trim() || busy} onClick={async () => { const r = await call(`redemptions/${voiding.id}/void`, { reason }, "Correction recorded."); if (r) { setVoiding(null); setReason(""); refresh(); } }}>Record correction</button></div>
        </Sheet>
      )}
      {pausing && (
        <Sheet title={`Pause ${d.label}?`} onClose={() => setPausing(false)}>
          <p className="muted">A paused coupon can't be used for a visit until you resume it.</p>
          <Field label="Reason" id="pr" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. customer lost the leaflet" />
          <div className="btns"><button className="btn ghost" onClick={() => setPausing(false)}>Cancel</button><button className="btn" disabled={busy} onClick={async () => { const r = await call(`issues/${d.issue}`, { reason }, "Coupon paused."); if (r) { setPausing(false); setReason(""); refresh(); } }}>Pause coupon</button></div>
        </Sheet>
      )}
    </>
  );
}

function VisitForm({ ctx, d, onDone }) {
  const [m, setM] = useState("");
  const [name, setName] = useState("");
  const [found, setFound] = useState(null);
  const [run, busy] = useAction();
  const [err, setErr] = useState("");
  const digits = m.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  useEffect(() => {
    setFound(null);
    if (digits.length !== 10) return;
    let live = true;
    api(`customers?limit=5&q=${digits}`, { club: ctx.club }).then((r) => { if (live) setFound(r.find((c) => c.mobile === digits) || false); }).catch(() => {});
    return () => { live = false; };
  }, [digits, ctx.club]);
  async function save(e) {
    e.preventDefault();
    setErr("");
    if (!/^[6-9]\d{9}$/.test(digits)) { setErr("Enter the friend's 10-digit mobile number starting with 6, 7, 8 or 9."); return; }
    if (!found && !name.trim()) { setErr("Enter the friend's name."); return; }
    try {
      const r = await api("visits", { method: "POST", club: ctx.club, body: { club: ctx.club, issue: d.issue, visitor_mobile: digits, visitor_name: name.trim(), day1: true } });
      onDone(r);
    } catch (x) { setErr(x.message); }
  }
  return (
    <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="rowflex">
        <Field label="Friend's mobile" id="vm" value={m} onChange={(e) => setM(e.target.value)} inputMode="numeric" placeholder="10 digits" autoComplete="off" />
        {found ? <div style={{ flex: "1 1 180px" }}><span className="muted">Already a customer</span><div className="big" style={{ fontSize: 16 }}>{found.name} <span className={"pill " + STAGE_PILL[found.stage]}>{found.stage}</span></div></div>
          : <Field label="Friend's name" id="vn" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoComplete="off" />}
      </div>
      {err && <div className="alert bad">{err}</div>}
      <button className="btn" disabled={busy}>Register friend &amp; record Day 1</button>
      <p className="muted">A person can be a referral visitor only once, ever. People who have had a trial or are CVC members can't use referral coupons.</p>
    </form>
  );
}

function IssueFlow({ ctx, d, reset, preset }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 250);
  const list = useLoad(dq.length >= 2 ? `customers?limit=6&q=${encodeURIComponent(dq)}` : null, { club: ctx.club });
  const [cust, setCust] = useState(null);       // full customer record
  const [nc, setNc] = useState(null);           // {name, mobile} for a new customer
  const [coach, setCoach] = useState("");
  const [purpose, setPurpose] = useState("TRIAL");
  const [done, setDone] = useState(null);
  const coaches = useLoad("coaches", { club: ctx.club });
  const [run, busy] = useAction();
  async function pickCustomer(id) {
    const c = await run(() => api(`customers/${id}`, { club: ctx.club }));
    if (c) { setCust(c); setNc(null); const first = c.purposes.find((p) => !p.locked); setPurpose(first ? first.key : ""); }
  }
  useEffect(() => { if (preset) pickCustomer(preset); /* eslint-disable-next-line */ }, [preset]);
  const headId = ((coaches.data || []).find((c) => c.is_head && c.is_active) || {}).id;
  const coachId = cust && cust.coach ? cust.coach : coach || headId || "";
  const purposes = cust ? cust.purposes : [
    { key: "TRIAL", label: "3 Days Trial", hint: "Starts the trial · once per mobile number, ever", locked: false, state: "Available" },
    { key: "CVC", label: "CVC Membership", hint: "Needs a completed trial", locked: true, state: "Locked" },
    { key: "WEEKLY", label: "Weekly Results", hint: "CVC members with an approved award", locked: true, state: "Locked" },
  ];
  const ready = (cust || (nc && nc.name.trim() && nc.mobile.trim())) && coachId && purpose;
  async function issue() {
    const payload = { club: ctx.club, unit: d.unit, purpose, coach: coachId, ...(cust ? { customer: cust.id } : { new_customer: { name: nc.name.trim(), mobile: nc.mobile.trim() } }) };
    const r = await run(() => api("issues", { method: "POST", club: ctx.club, body: payload }));
    if (r) setDone(r);
  }
  if (done) {
    const text = `Hello! ${done.customer_name} has shared a Shreyas Wellness World coupon (${done.coupon}) with you. Bring it to ${ctx.clubName} for two free wellness visits (Day 1 and Day 2). Valid until ${fmtDate(done.expires_on)}.`;
    return (<>
      <div className="coupon"><Ticket d={d} /><div><span className="pill good" style={{ alignSelf: "flex-start" }}>Issued</span><span className="big">Given to {done.customer_name} · {done.purpose_label}</span><span className="muted">Valid until <b>{fmtDate(done.expires_on)}</b> · coach {done.coach_name}</span></div></div>
      <Steps done={1} now={1} />
      <div className="rowflex">
        <a className="btn gold" style={{ textDecoration: "none" }} href={"https://wa.me/?text=" + encodeURIComponent(text)} target="_blank" rel="noopener">Share on WhatsApp</a>
        <button className="btn ghost" onClick={() => copyText(text, toast)}>Copy message</button>
        <button className="btn ghost" onClick={reset}>Next coupon</button>
      </div>
    </>);
  }
  return (<>
    <div className="coupon"><Ticket d={d} /><div><span className="pill gold" style={{ alignSelf: "flex-start" }}>In your stock</span><span className="big">Issue this coupon</span><span className="muted">{d.batch} · valid {d.valid_days} days from today, until {fmtDate(d.expires_if_issued_today)}</span></div></div>
    <Steps done={0} now={0} />
    <div className="g2" style={{ gap: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span className="lbl">Customer</span>
        {cust ? (
          <div className="pick"><button className="on" onClick={() => setCust(null)}><span className="t"><b>{cust.name}</b><i>{mob(cust.mobile)} · tap to change</i></span><span className={"pill " + STAGE_PILL[cust.stage]}>{cust.stage}</span></button></div>
        ) : nc ? (
          <>
            <div className="rowflex"><Field label="Name" id="nn" value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} placeholder="Full name" /><Field label="Mobile" id="nm" value={nc.mobile} onChange={(e) => setNc({ ...nc, mobile: e.target.value })} inputMode="numeric" placeholder="10 digits" /></div>
            <button className="linkbtn" style={{ alignSelf: "flex-start" }} onClick={() => setNc(null)}>Search existing customers instead</button>
          </>
        ) : (
          <>
            <label className="sinp" htmlFor="cs"><Icon name="search" size={18} /><input id="cs" placeholder="Search name or mobile" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" /></label>
            <div className="pick">
              {(list.data || []).map((c) => <button key={c.id} onClick={() => pickCustomer(c.id)}><span className="t"><b><Hl text={c.name} q={dq} /></b><i><Hl text={mob(c.mobile)} q={dq} /></i></span><span className={"pill " + STAGE_PILL[c.stage]}>{c.stage}</span></button>)}
              {dq.length >= 2 && list.data && list.data.length === 0 && <p className="muted">No customer matches "{dq}".</p>}
              <button onClick={() => setNc({ name: /\d/.test(q) ? "" : q, mobile: /\d/.test(q) ? q : "" })}><span className="t"><b>+ New customer</b><i>Add them here without leaving this screen</i></span></button>
            </div>
          </>
        )}
        {(cust || nc) && (cust && cust.coach ? <div className="alert info">Coach from profile: <b>{cust.coach_name}</b></div> : (
          <>
            <span className="lbl">Responsible coach</span>
            <div className="chips">{(coaches.data || []).filter((c) => c.is_active).map((c) => <button key={c.id} className={"chip" + (String(coachId) === String(c.id) ? " on" : "")} onClick={() => setCoach(c.id)}>{c.name}{c.is_head ? " · Head coach" : ""}</button>)}</div>
            {coaches.data && !coaches.data.some((c) => c.is_active) && <p className="muted">No active coaches. Add one under Coaches first.</p>}
          </>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="lbl">Coupon is for</span>
        <div className="pick">{purposes.map((p) => (
          <button key={p.key} className={purpose === p.key ? "on" : ""} disabled={p.locked} onClick={() => setPurpose(p.key)}><span className="t"><b>{p.label}</b><i>{p.key === "TRIAL" ? "Starts the trial · once per mobile number, ever" : p.hint}</i></span><span className={"pill " + (p.locked ? "grey" : purpose === p.key ? "gold" : "good")}>{purpose === p.key && !p.locked ? "Selected" : p.state}</span></button>
        ))}</div>
      </div>
    </div>
    <button className="btn" disabled={!ready || busy} onClick={issue}>Issue coupon {d.label}</button>
  </>);
}

// ------------------------------------------------------------------ filtered lists
function Applied({ items, clear }) {
  const on = items.filter((x) => x[2]);
  if (!on.length) return null;
  return (
    <div className="applied"><span>Filtered by</span>
      {on.map(([k, l, v]) => <span key={k} className="x"><b>{l}:</b> {v}<button onClick={() => clear(k)} aria-label={`Remove ${l} filter`}>✕</button></span>)}
      <button style={{ textDecoration: "underline" }} onClick={() => clear("*")}>Clear all</button>
    </div>
  );
}

function qs(obj) {
  return Object.entries(obj).filter(([, v]) => v !== "" && v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}

export function CustomersList({ ctx }) {
  const [f, setF] = useState({ q: "", stage: "", coach: "", joined: "", sort: "", source: "" });
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const dq = useDebounced(f.q.trim());
  const coaches = useLoad("coaches", { club: ctx.club });
  const [adding, setAdding] = useState(false);
  const { data, error } = useLoad(`list/customers?${qs({ ...f, q: dq, page })}`, { club: ctx.club });
  useEffect(() => { setPage(1); }, [dq, f.stage, f.coach, f.joined, f.sort, f.source]);
  useEffect(() => { if (data) setRows((r) => (data.page === 1 ? data.results : [...r, ...data.results])); }, [data]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const clear = (k) => setF(k === "*" ? { q: "", stage: "", coach: "", joined: "", sort: f.sort, source: "" } : { ...f, [k]: "" });
  const coachName = (id) => ((coaches.data || []).find((c) => String(c.id) === String(id)) || {}).name || (id === "none" ? "No coach" : "");
  const JOINED = { week: "This week", month: "This month", "3m": "Last 3 months" };
  return (
    <>
      <div className="head"><div><p className="eyebrow">{ctx.clubName}</p><h1 className="pg">Customers</h1></div><button className="btn" style={{ width: "auto" }} onClick={() => setAdding(true)}>+ New customer</button></div>
      <section className="fbar">
        <div className="top2">
          <label className="sinp" htmlFor="fq"><Icon name="search" size={18} /><input id="fq" placeholder="Search name or mobile" value={f.q} onChange={(e) => set("q", e.target.value)} autoComplete="off" /></label>
          <select className="sel" aria-label="Coach" value={f.coach} onChange={(e) => set("coach", e.target.value)}><option value="">All coaches</option>{(coaches.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_active ? "" : " (inactive)"}</option>)}<option value="none">No coach</option></select>
          <select className="sel" aria-label="How they came" value={f.source} onChange={(e) => set("source", e.target.value)}><option value="">Any source</option><option value="WALKIN">Walk-in</option><option value="COUPON">Invitation coupon</option><option value="EXTERNAL">Referred from outside</option><option value="OTHER">Other</option></select>
          <select className="sel" aria-label="Joined" value={f.joined} onChange={(e) => set("joined", e.target.value)}><option value="">Joined any time</option>{Object.entries(JOINED).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <select className="sel" aria-label="Sort" value={f.sort} onChange={(e) => set("sort", e.target.value)}><option value="">Newest first</option><option value="name">Name A–Z</option><option value="invited">Most friends invited</option></select>
        </div>
        <div className="fchips" role="group" aria-label="Stage">
          {["", "New", "Visitor", "In trial", "Trial done", "CVC member"].map((s) => <button key={s || "all"} className={"chip" + (f.stage === s ? " on" : "")} onClick={() => set("stage", s)}>{s || "All"}{data && <span className="n">{data.counts[s || "All"]}</span>}</button>)}
        </div>
        <Applied items={[["q", "Search", dq], ["stage", "Stage", f.stage], ["coach", "Coach", f.coach && coachName(f.coach)], ["joined", "Joined", JOINED[f.joined]], ["source", "Came", { WALKIN: "Walk-in", COUPON: "Invitation coupon", EXTERNAL: "Referred from outside", OTHER: "Other" }[f.source]]]} clear={clear} />
      </section>
      <section className="panel">
        {error ? <p className="err">{error}</p> : !data ? <Loading /> : rows.length === 0 ? <div className="empty"><b>No customers match</b>{(dq || f.stage || f.coach || f.joined) && <><br /><button className="linkbtn" onClick={() => clear("*")}>Clear filters</button></>}</div> : <>
          <span className="muted">{data.total} customer{data.total === 1 ? "" : "s"}</span>
          <div className="tw tblonly"><table><thead><tr><th>Name</th><th>Mobile</th><th>Stage</th><th>Coach</th><th className="r">Friends invited</th><th className="r">Joined</th></tr></thead><tbody>
            {rows.map((c) => <tr key={c.id} className="click" onClick={() => ctx.go("customer", c.id)}><td><b style={{ fontWeight: 500 }}><Hl text={c.name} q={dq} /></b></td><td className="num"><Hl text={mob(c.mobile)} q={dq} /></td><td><span className={"pill " + STAGE_PILL[c.stage]}>{c.stage}</span></td><td>{c.coach || <span className="muted">—</span>}</td><td className="r num">{c.invited || "—"}</td><td className="r muted">{dshort(c.joined)}</td></tr>)}
          </tbody></table></div>
          <div className="cards">{rows.map((c) => <button key={c.id} className="pc" onClick={() => ctx.go("customer", c.id)}><span className="t"><b><Hl text={c.name} q={dq} /></b><i><Hl text={mob(c.mobile)} q={dq} />{c.coach ? " · " + c.coach : ""}</i></span><span className={"pill " + STAGE_PILL[c.stage]}>{c.stage}</span></button>)}</div>
          {data.page < data.pages && <button className="btn ghost sm" style={{ alignSelf: "center" }} onClick={() => setPage(data.page + 1)}>Show more</button>}
        </>}
      </section>
      {adding && <NewCustomer ctx={ctx} onClose={() => setAdding(false)} />}
    </>
  );
}

function NewCustomer({ ctx, onClose }) {
  return <CustomerForm ctx={ctx} onClose={onClose} onSaved={(c) => { onClose(); ctx.go("customer", c.id); }} />;
}

const REF_STATUSES = ["Waiting", "Friend registered", "Day 1 done", "Day 2 done", "Expired", "Paused"];
export function ReferralsList({ ctx, arg }) {
  const [f, setF] = useState({ q: "", status: REF_STATUSES.includes(arg) ? arg : "", coach: "", batch: "" });
  const dq = useDebounced(f.q.trim());
  const coaches = useLoad("coaches", { club: ctx.club });
  const stock = useLoad("stock", { club: ctx.club });
  const { data, error } = useLoad(`list/referrals?${qs({ ...f, q: dq })}`, { club: ctx.club });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const clear = (k) => setF(k === "*" ? { q: "", status: "", coach: "", batch: "" } : { ...f, [k]: "" });
  const batches = Array.from(new Set([...(stock.data || []).map((b) => b.batch), ...((data && data.results) || []).map((r) => r.batch)])).sort();
  return (
    <>
      <div className="head"><div><p className="eyebrow">{ctx.clubName}</p><h1 className="pg">Referrals</h1></div><button className="btn ghost" style={{ width: "auto" }} onClick={() => ctx.go("desk")}>Open coupon desk</button></div>
      <section className="fbar">
        <div className="top2">
          <label className="sinp" htmlFor="fq"><Icon name="search" size={18} /><input id="fq" placeholder="Coupon number, holder or friend" value={f.q} onChange={(e) => set("q", e.target.value)} autoComplete="off" /></label>
          <select className="sel" aria-label="Coach" value={f.coach} onChange={(e) => set("coach", e.target.value)}><option value="">All coaches</option>{(coaches.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <BatchSelect value={f.batch} onChange={(v) => set("batch", v)} codes={batches} />
        </div>
        <div className="fchips" role="group" aria-label="Status">
          {["", ...REF_STATUSES].map((s) => <button key={s || "all"} className={"chip" + (f.status === s ? " on" : "")} onClick={() => set("status", s)}>{s === "Waiting" ? "Waiting for friend" : s || "All"}{data && <span className="n">{data.counts[s || "All"]}</span>}</button>)}
        </div>
        <Applied items={[["q", "Search", dq], ["status", "Status", f.status], ["coach", "Coach", f.coach && ((coaches.data || []).find((c) => String(c.id) === f.coach) || {}).name]]} clear={clear} />
      </section>
      <section className="panel">
        {error ? <p className="err">{error}</p> : !data ? <Loading /> : data.results.length === 0 ? <div className="empty"><b>No coupons match</b>{(dq || f.status || f.coach || f.batch) && <><br /><button className="linkbtn" onClick={() => clear("*")}>Clear filters</button></>}</div> : <>
          <span className="muted">{data.total} coupon{data.total === 1 ? "" : "s"}{data.total > data.results.length ? ` · showing the latest ${data.results.length}` : ""}</span>
          <div className="tw tblonly"><table><thead><tr><th>Coupon</th><th>Given to</th><th>Friend</th><th>Status</th><th>Coach</th><th className="r">Issued</th><th className="r">Valid until</th></tr></thead><tbody>
            {data.results.map((r) => <tr key={r.id} className="click" onClick={() => (r.number ? ctx.go("desk", r.number) : ctx.go("customer", r.visitor_id))}><td><b style={{ fontWeight: 500 }}><Hl text={r.coupon} q={dq} /></b></td><td><Hl text={r.holder} q={dq} /></td><td>{r.visitor ? <Hl text={r.visitor} q={dq} /> : <span className="muted">—</span>}</td><td><span className={"pill " + REF_PILL[r.status]}>{r.status}</span></td><td>{r.coach}</td><td className="r muted">{dshort(r.issued_at)}</td><td className="r muted">{r.expires_on ? dshort(r.expires_on) : "—"}</td></tr>)}
          </tbody></table></div>
          <div className="cards">{data.results.map((r) => <button key={r.id} className="pc" onClick={() => (r.number ? ctx.go("desk", r.number) : ctx.go("customer", r.visitor_id))}><span className="t"><b><Hl text={r.coupon} q={dq} /></b><i><Hl text={r.holder} q={dq} />{r.visitor ? <> → <Hl text={r.visitor} q={dq} /></> : " · waiting for a friend"} · until {dshort(r.expires_on)}</i></span><span className={"pill " + REF_PILL[r.status]}>{r.status}</span></button>)}</div>
        </>}
      </section>
    </>
  );
}

function BatchSelect({ value, onChange, codes }) {
  return (
    <select className="sel" aria-label="Batch" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All batches</option>
      {codes.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}

export function CoachesList({ ctx, arg }) {
  const [f, setF] = useState({ q: arg || "", status: "Active", sort: "" });
  const dq = useDebounced(f.q.trim());
  const { data, error, reload } = useLoad(`list/coaches?${qs({ ...f, q: dq })}`, { club: ctx.club });
  const [form, setForm] = useState(null);
  const [run] = useAction();
  const canEdit = ctx.role !== "SUPERVISOR";
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  async function toggle(c) {
    const r = await run(() => api(`coaches/${c.id}`, { method: "PATCH", club: ctx.club, body: { is_active: !c.is_active } }), c.is_active ? `${c.name} marked inactive.` : `${c.name} active again.`);
    if (r) reload();
  }
  return (
    <>
      <div className="head"><div><p className="eyebrow">{ctx.clubName}</p><h1 className="pg">Wellness coaches</h1></div>{canEdit && <button className="btn" style={{ width: "auto" }} onClick={() => setForm({})}>+ Add coach</button>}</div>
      <section className="fbar">
        <div className="top2">
          <label className="sinp" htmlFor="fq"><Icon name="search" size={18} /><input id="fq" placeholder="Name, mobile or Herbalife ID" value={f.q} onChange={(e) => set("q", e.target.value)} autoComplete="off" /></label>
          <select className="sel" aria-label="Sort" value={f.sort} onChange={(e) => set("sort", e.target.value)}><option value="">Most CVC first</option><option value="issued">Most coupons issued</option><option value="name">Name A–Z</option></select>
        </div>
        <div className="fchips" role="group" aria-label="Status">{["Active", "Inactive", "All"].map((s) => <button key={s} className={"chip" + (f.status === s ? " on" : "")} onClick={() => set("status", s)}>{s}{data && <span className="n">{data.counts[s]}</span>}</button>)}</div>
        <Applied items={[["q", "Search", dq], ["status", "Status", f.status !== "Active" ? f.status : ""]]} clear={(k) => setF(k === "*" ? { q: "", status: "Active", sort: f.sort } : { ...f, [k]: k === "status" ? "Active" : "" })} />
      </section>
      {!canEdit && <div className="banner info">View only. The Club Owner adds and edits coaches.</div>}
      <section className="panel">
        {error ? <p className="err">{error}</p> : !data ? <Loading /> : data.results.length === 0 ? <div className="empty"><b>No coaches match</b></div> : <>
          <div className="tw tblonly"><table><thead><tr><th>Coach</th><th>Herbalife ID</th><th>Mobile</th><th>Upline</th><th className="r">Customers</th><th className="r">Coupons</th><th className="r">Trials</th><th className="r">CVC</th>{canEdit && <th />}</tr></thead><tbody>
            {data.results.map((c) => <tr key={c.id}><td><b style={{ fontWeight: 500 }}><Hl text={c.name} q={dq} /></b> {c.is_head && <span className="pill gold">Head coach · Owner</span>} {!c.is_active && <span className="pill grey">Inactive</span>}</td><td className="num"><Hl text={c.herbalife_id} q={dq} /></td><td className="num"><Hl text={mob(c.mobile)} q={dq} /></td><td className="muted">{c.upline_name || "—"}</td><td className="r num">{c.customers}</td><td className="r num">{c.issued}</td><td className="r num">{c.trials}</td><td className="r"><span className={"pill " + (c.cvc ? "good" : "grey")}>{c.cvc}</span></td>
              {canEdit && <td className="r">{c.is_head ? <span className="muted">Follows the Owner's login</span> : <><button className="chip" onClick={() => setForm(c)}>Edit</button> <button className="chip" onClick={() => toggle(c)}>{c.is_active ? "Deactivate" : "Activate"}</button></>}</td>}</tr>)}
          </tbody></table></div>
          <div className="cards">{data.results.map((c) => <button key={c.id} className="pc" onClick={() => canEdit && !c.is_head && setForm(c)}><span className="t"><b><Hl text={c.name} q={dq} />{c.is_head ? " · Head coach" : ""}</b><i><Hl text={c.herbalife_id} q={dq} /> · {c.customers} customers · {c.issued} coupons</i></span><span className={"pill " + (c.cvc ? "good" : "grey")}>{c.cvc} CVC</span></button>)}</div>
        </>}
      </section>
      {form && <CoachForm ctx={ctx} coach={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} extra={form.id && canEdit ? <button type="button" className="btn ghost" onClick={() => { toggle(form); setForm(null); }}>{form.is_active ? "Mark inactive" : "Mark active"}</button> : null} />}
    </>
  );
}
