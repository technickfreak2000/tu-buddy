export const IDP_ORIGIN = "https://shibboleth.tubit.tu-berlin.de";
export const SERVICE_ORIGINS = ["https://isis.tu-berlin.de", "https://moseskonto.tu-berlin.de"];
export const DEFAULT_SETTINGS = Object.freeze({enabled: true, isis: true, moses: true, username: "", password: "", totp: ""});
export const WINDOW_MS = 10 * 60 * 1000;

export function classifyUrl(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.origin === SERVICE_ORIGINS[0]) return "isis";
    if (url.origin === SERVICE_ORIGINS[1] && /^\/moses(?:\/|$)/.test(url.pathname)) return "moses";
    if (url.origin === IDP_ORIGIN && /^\/idp\/profile\/(?:SAML2|Shibboleth|cas|oidc)\//i.test(url.pathname)) return "idp";
  } catch { /* Invalid URLs never qualify. */ }
  return null;
}

export function trustedSender(sender) {
  return Number.isInteger(sender.tab?.id) && sender.frameId === 0 && Boolean(classifyUrl(sender.url));
}

export function safeFormAction(action, page) {
  try {
    const target = new URL(action, page);
    return classifyUrl(page) === "idp" && classifyUrl(target.href) === "idp" &&
      target.origin === new URL(page).origin && !target.hash;
  } catch { return false; }
}

export function freshState(state = {}, now = Date.now()) {
  return {paused: state.paused || "", attempts: (state.attempts || []).filter(a => now - a.at < WINDOW_MS),
    lastOtpCounter: state.lastOtpCounter ?? -1};
}

export function reserveAttempt(state, {kind, tabId, flow}, now = Date.now()) {
  const attempts = state.attempts;
  if (attempts.some(a => !a.settled && a.kind === kind && a.tabId === tabId && a.flow === flow)) {
    return "This login step was already attempted. Use Resume to try again.";
  }
  const limit = kind === "start" ? 6 : 3;
  if (attempts.filter(a => a.kind === kind).length >= limit) {
    return "Automatic login paused after repeated attempts. Check your settings, then use Resume.";
  }
  attempts.push({kind, tabId, flow, at: now});
  return "";
}
