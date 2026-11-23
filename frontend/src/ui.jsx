import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "./api";

const P = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  clubs: <path d="M4 21V8l8-5 8 5v13M9 21v-6h6v6M3 21h18" />,
  coupon: <><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z" /><path d="M14 6v12" strokeDasharray="2 2" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="M10.8 12.2 20 3M17 6l3 3" /></>,
  users: <><circle cx="9" cy="8" r="4" /><path d="M2 21c0-4 3-6 7-6s7 2 7 6M16 4a4 4 0 0 1 0 8M22 21c0-3-2-5-4-5.5" /></>,
  door: <path d="M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" />,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  trial: <><path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /><path d="m9 16 2 2 4-4" /></>,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
  award: <><circle cx="12" cy="9" r="6" /><path d="M8.5 14 7 22l5-3 5 3-1.5-8" /></>,
  coach: <><circle cx="12" cy="7" r="4" /><path d="M5 21c0-4 3-7 7-7s7 3 7 7" /></>,
  tree: <><circle cx="12" cy="5" r="2.5" /><circle cx="5" cy="19" r="2.5" /><circle cx="19" cy="19" r="2.5" /><path d="M12 7.5v4M12 11.5 5 16.5M12 11.5l7 5" /></>,
  back: <path d="M15 18l-6-6 6-6" />,
  out: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  chev: <path d="m9 18 6-6-6-6" />,
  log: <><path d="M4 4h16v16H4z" /><path d="M8 9h8M8 13h8M8 17h5" /></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>,
  leaf: <path d="M12 20c-4 0-8-3-9-7 4 0 7 2 9 7Zm0 0c4 0 8-3 9-7-4 0-7 2-9 7Zm0 0c-2-3-2-9 0-14 2 5 2 11 0 14Z" />,
};

export function Icon({ name, size = 22, color = "currentColor", width = 1.8 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  );
}

export const Kv = ({ k, v }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14 }}><span>{k}</span><b style={{ textAlign: "right" }}>{v}</b></div>
);

export function Field({ label, id, as, children, ...props }) {
  return (
    <label className="f" htmlFor={id}>{label}
      {as === "textarea" ? <textarea className="inp" id={id} {...props} /> :
       as === "select" ? <select className="inp" id={id} {...props}>{children}</select> :
       <input className="inp" id={id} {...props} />}
    </label>
  );
}

export function Sheet({ title, onClose, children }) {
  return (
    <div className="sheet-bg" onClick={(e) => e.target === e.currentTarget && onClose && onClose()}>
      <div className="sheet" role="dialog" aria-label={title}>
        <p className="h2">{title}</p>
        {children}
      </div>
    </div>
  );
}

export const Empty = ({ children }) => <div className="empty">{children}</div>;
export const Loading = () => <div className="empty"><span className="spin" /></div>;

// ---- toast ----
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [msg, setMsg] = useState("");
  const t = useRef();
  const show = useCallback((m) => { setMsg(m); clearTimeout(t.current); t.current = setTimeout(() => setMsg(""), 3200); }, []);
  return <ToastCtx.Provider value={show}>{children}{msg && <div className="toast" role="status">{msg}</div>}</ToastCtx.Provider>;
}

// ---- data loading ----
export function useLoad(path, opts = {}, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setError("");
    api(path, opts).then((d) => live && setData(d)).catch((e) => live && setError(e.message));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, opts.club, tick, ...deps]);
  return { data, error, reload: () => setTick((x) => x + 1), setData };
}

// Run an API action with a busy flag and toast on error/success
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, okMsg) => {
    setBusy(true);
    try {
      const r = await fn();
      if (okMsg) toast(typeof okMsg === "function" ? okMsg(r) : okMsg);
      return r;
    } catch (e) {
      toast(e.message);
      return undefined;
    } finally { setBusy(false); }
  }, [toast]);
  return [run, busy];
}

export async function copyText(text, toast) {
  try { await navigator.clipboard.writeText(text); toast("Copied. Paste it into WhatsApp."); }
  catch (e) { toast("Couldn't copy automatically. Press and hold the text to copy it."); }
}

export const stageTag = (s) => (s === "CVC member" ? "tag" : s === "New" ? "tag grey" : "tag gold");
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");
export const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
export const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
