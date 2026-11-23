import { useEffect, useState } from "react";
import { api } from "../api";
import { useCoaches } from "./Customers";
import { CoachForm } from "./Club";
import { Icon, Kv, Loading, Sheet, stageTag, useAction, useLoad, useToast } from "../ui";

export function Issue({ ctx, arg }) {
  const [custId, setCustId] = useState(arg || null);
  const [done, setDone] = useState(null);
  if (done) return <IssueDone ctx={ctx} issue={done} onAnother={() => { setDone(null); setCustId(null); ctx.go("issue"); }} />;
  return custId ? <IssueForm ctx={ctx} custId={custId} onChange={() => setCustId(null)} onDone={setDone} /> : <PickCustomer ctx={ctx} onPick={setCustId} />;
}

function PickCustomer({ ctx, onPick }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const { data } = useLoad("customers?limit=20" + (query ? "&q=" + encodeURIComponent(query) : ""), { club: ctx.club });
  return (
    <div className="split">
      <div className="card">
        <p className="lbl">1 · Customer</p>
        <input className="inp" id="issueSearch" placeholder="Type a name or mobile" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find customer" autoFocus />
        {!data ? <Loading /> : data.length === 0 ? <p className="muted">No customer found. Add them from Customers first.</p> : data.map((c) => (
          <button key={c.id} className="row" onClick={() => onPick(c.id)}><span className="grow"><b>{c.name}</b><span className="muted">{c.mobile}</span></span><span className={stageTag(c.stage)}>{c.stage}</span></button>
        ))}
      </div>
      <div className="card only-wide"><p className="lbl">How issuing works</p><p className="muted">Pick the customer, confirm their coach, choose what the coupon is for, then pick the number from your club's stock. The paper coupon goes to the customer, who passes it to a friend.</p></div>
    </div>
  );
}

function IssueForm({ ctx, custId, onChange, onDone }) {
  const cust = useLoad(`customers/${custId}`, { club: ctx.club });
  const stock = useLoad("stock", { club: ctx.club });
  const coaches = useCoaches(ctx);
  const [coach, setCoach] = useState(null);
  const [purpose, setPurpose] = useState(null);
  const [open, setOpen] = useState(null);
  const [picked, setPicked] = useState(null);     // {unit?, batch, number}
  const [typed, setTyped] = useState("");
  const [typedErr, setTypedErr] = useState("");
  const [choices, setChoices] = useState(null);
  const [newCoach, setNewCoach] = useState(false);
  const [run, busy] = useAction();

  if (cust.error) return <p className="err">{cust.error}</p>;
  if (!cust.data || !stock.data) return <Loading />;
  const c = cust.data;
  const coachId = c.coach || coach;

  async function find() {
    setTypedErr("");
    const n = parseInt(typed, 10);
    if (isNaN(n)) { setTypedErr("Enter the printed number on the coupon."); return; }
    const hits = await run(() => api(`stock/find?number=${n}`, { club: ctx.club }));
    if (!hits) return;
    if (hits.length === 0) setTypedErr(`#${n} isn't in your club's unissued stock. Check the number on the coupon.`);
    else if (hits.length === 1) setPicked(hits[0]);
    else setChoices({ number: n, hits });
  }
  async function pickChip(batch, number) {
    const hits = await run(() => api(`stock/find?number=${number}`, { club: ctx.club }));
    const h = hits && hits.find((x) => x.batch === batch);
    if (h) setPicked(h);
  }
  async function confirm() {
    const r = await run(() => api("issues", { method: "POST", club: ctx.club, body: { club: ctx.club, customer: c.id, unit: picked.unit, purpose, coach: coachId } }));
    if (r) onDone(r);
  }
  const blocked = !(coachId && purpose && picked);
  const help = !coachId ? "Choose a coach for this customer." : !purpose ? "Choose what the coupon is for." : !picked ? "Pick a coupon number from your stock." : "Ready to issue.";
  const canAddCoach = ctx.isAdmin || ctx.role === "OWNER";

  return (
    <div className="split">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="card">
          <p className="lbl">1 · Customer</p>
          <div className="row on" style={{ cursor: "default" }}><span className="grow"><b>{c.name}</b><span className="muted">{c.mobile}</span></span><button className="chip" onClick={onChange}>Change</button></div>
          <p className="lbl" style={{ marginTop: 6 }}>2 · Responsible coach</p>
          {c.coach ? (
            <div className="row" style={{ cursor: "default", background: "#F1EFEA" }}><Icon name="lock" size={16} /><span style={{ flex: 1 }}>{c.coach_name}</span><span className="muted" style={{ fontSize: 12 }}>from profile</span></div>
          ) : (
            <>
              <p className="muted">This customer has no coach yet. The coach you pick is saved to their profile.</p>
              <div className="chips">
                {(coaches.data || []).filter((x) => x.is_active).map((x) => <button key={x.id} className={"chip" + (coach === x.id ? " on" : "")} onClick={() => setCoach(x.id)}>{x.name}</button>)}
                {canAddCoach && <button className="chip" onClick={() => setNewCoach(true)}>+ New coach</button>}
              </div>
            </>
          )}
          <p className="lbl" style={{ marginTop: 6 }}>3 · Purpose</p>
          {c.purposes.map((p) => {
            const on = purpose === p.key;
            return (
              <button key={p.key} className={"row" + (on ? " on" : "")} disabled={p.locked} onClick={() => setPurpose(p.key)}>
                <span className="grow"><b>{p.label}</b><span style={{ fontSize: 12 }}>{p.key === "TRIAL" && !c.trial ? "Starts the 3-day trial now · once per person" : p.hint}</span></span>
                <span className={"tag " + (p.locked ? "grey" : on ? "gold" : "")}>{on ? "Selected" : p.state}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="card">
          <p className="lbl">4 · Coupon from your stock</p>
          <form style={{ display: "flex", gap: 8 }} onSubmit={(e) => { e.preventDefault(); find(); }}>
            <input className="inp" id="typed" inputMode="numeric" placeholder="Printed number, e.g. 35" value={typed} onChange={(e) => { setTyped(e.target.value); setTypedErr(""); }} aria-label="Printed coupon number" />
            <button className="btn" style={{ width: 90, flex: "none" }} disabled={busy}>Find</button>
          </form>
          {typedErr && <p className="err">{typedErr}</p>}
          {stock.data.length === 0 && <p className="muted">Your club has no coupons in stock. Ask the Super Admin to allocate a range.</p>}
          {stock.data.map((b) => (
            <div key={b.batch} style={{ border: "1px solid var(--line)", borderTop: "4px solid " + b.color, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><b>{b.batch}</b><span className="muted">{b.count} available</span></div>
              {b.ranges.map(([s, e]) => {
                const key = b.batch + ":" + s, isOpen = open === key;
                const nums = []; if (isOpen) for (let n = s; n <= e; n++) nums.push(n);
                return (
                  <div key={key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <button className="row" style={{ minHeight: 44 }} onClick={() => setOpen(isOpen ? null : key)}>
                      <span style={{ flex: 1 }}><b>{s === e ? `#${s}` : `Range #${s} – #${e}`}</b></span><span className="muted">{e - s + 1} available</span><span style={{ fontSize: 18, color: "var(--muted)", width: 16, textAlign: "center" }}>{isOpen ? "−" : "+"}</span>
                    </button>
                    {isOpen && <div className="chips" style={{ gap: 6 }}>{nums.map((n) => <button key={n} className={"chip" + (picked && picked.batch === b.batch && picked.number === n ? " on" : "")} onClick={() => pickChip(b.batch, n)}>#{n}</button>)}</div>}
                  </div>
                );
              })}
            </div>
          ))}
          {picked && <div className="banner ok"><b>Selected: {picked.batch} #{picked.number}</b></div>}
          <button className="btn" style={{ width: "100%" }} disabled={blocked || busy} onClick={confirm}>Confirm &amp; issue coupon</button>
          <p className="muted" style={{ textAlign: "center" }}>{help}</p>
        </div>
      </div>
      {choices && (
        <Sheet title={`#${choices.number} is in ${choices.hits.length} batches`} onClose={() => setChoices(null)}>
          <p className="muted">Check the batch label on the paper bundle in your hand and pick the matching one.</p>
          {choices.hits.map((h) => (
            <button key={h.unit} className="row" style={{ borderLeft: "6px solid " + h.color }} onClick={() => { setPicked(h); setChoices(null); }}><span className="grow"><b>{h.batch}</b><span className="muted">Coupon #{h.number}</span></span></button>
          ))}
          <button className="btn ghost" style={{ width: "100%" }} onClick={() => setChoices(null)}>Cancel</button>
        </Sheet>
      )}
      {newCoach && <CoachForm ctx={ctx} onClose={() => setNewCoach(false)} onSaved={(x) => { setNewCoach(false); coaches.reload(); setCoach(x.id); }} />}
    </div>
  );
}

function IssueDone({ ctx, issue, onAnother }) {
  const toast = useToast();
  const text = `Hello! ${issue.customer_name} has shared a Shreyas Wellness World coupon (${issue.coupon}) with you. Bring it to our club for your Day 1 and Day 2 wellness visits.`;
  return (
    <div style={{ maxWidth: 460, width: "100%", margin: "24px auto 0", display: "flex", flexDirection: "column", gap: 14, textAlign: "center" }}>
      <span style={{ width: 76, height: 76, borderRadius: "50%", background: "var(--mint)", color: "var(--emerald)", display: "flex", alignItems: "center", justifyContent: "center", alignSelf: "center" }}><Icon name="check" size={38} width={2} /></span>
      <p className="h2" style={{ fontSize: 30 }}>Coupon issued</p>
      <div className="card" style={{ textAlign: "left" }}><Kv k="Coupon" v={issue.coupon} /><Kv k="Customer" v={issue.customer_name} /><Kv k="Purpose" v={issue.purpose_label} /><Kv k="Coach" v={issue.coach_name} /></div>
      <p className="muted">Give the paper coupon to the customer. Their friend must visit this same club to use Day 1 and Day 2.</p>
      <a className="btn" style={{ width: "100%", textDecoration: "none" }} href={"https://wa.me/?text=" + encodeURIComponent(text)} target="_blank" rel="noopener">Share on WhatsApp</a>
      <button className="btn ghost" style={{ width: "100%" }} onClick={() => { navigator.clipboard?.writeText(text).then(() => toast("Message copied."), () => {}); }}>Copy message</button>
      <button className="btn ghost" style={{ width: "100%" }} onClick={onAnother}>Issue another</button>
    </div>
  );
}
