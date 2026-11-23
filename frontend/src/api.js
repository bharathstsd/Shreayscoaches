// Talks to the Django API. The login token is kept on this device only.
const KEY = "sww_token";
let token = null;
try { token = localStorage.getItem(KEY); } catch (e) { /* private mode */ }

export function setToken(t) {
  token = t;
  try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}
export const hasToken = () => !!token;

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function api(path, { method = "GET", body, club, raw } = {}) {
  let url = "/api/" + path;
  if (club) url += (url.includes("?") ? "&" : "?") + "club=" + club;
  const headers = { Accept: "application/json" };
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = "Bearer " + token;
  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
  } catch (e) {
    throw new Error("No internet connection. Check your connection and try again.");
  }
  if (raw) {
    if (!res.ok) throw new Error("Couldn't download the report.");
    return res;
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty body */ }
  if (res.status === 401) { onUnauthorized(); throw new Error((data && data.error) || "Please log in again."); }
  if (!res.ok) {
    const err = new Error((data && data.error) || (res.status >= 500 ? "The server had a problem. Please try again in a minute." : "Something went wrong. Please try again."));
    err.status = res.status; err.data = data || {};
    throw err;
  }
  return data;
}
