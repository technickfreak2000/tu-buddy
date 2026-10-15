import {DEFAULT_SETTINGS, classifyUrl, trustedSender, safeFormAction, freshState, reserveAttempt} from "./lib/policy.js";
import {parseTotp, generateTotp} from "./lib/totp.js";

const SETTINGS_KEY = "settings";
const STATE_KEY = "runtime";
let queue = Promise.resolve();

async function settings() {
  return {...DEFAULT_SETTINGS, ...(await browser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]};
}
async function state() {
  const [session, local] = await Promise.all([browser.storage.session.get(STATE_KEY), browser.storage.local.get("pauseReason")]);
  return freshState({...session[STATE_KEY], paused: local.pauseReason || ""});
}
async function persist(runtime) {
  await browser.storage.session.set({[STATE_KEY]: runtime});
  await browser.storage.local.set({pauseReason: runtime.paused});
  await badge();
}
async function badge() {
  const [config, runtime] = await Promise.all([settings(), state()]);
  const paused = !config.enabled || Boolean(runtime.paused);
  await browser.action.setBadgeText({text: paused ? "OFF" : ""});
  await browser.action.setBadgeBackgroundColor({color: "#9c2834"});
  await browser.action.setTitle({title: paused ? "TU Auto Login — paused" : "TU Auto Login — active"});
}
function extensionPage(sender) {
  return !sender.tab || sender.url?.startsWith(browser.runtime.getURL(""));
}
function isOwnPage(sender) {
  return extensionPage(sender) && ["options/options.html", "popup/popup.html"].some(path => sender.url === browser.runtime.getURL(path));
}
async function handle(message, sender) {
  if (!message || typeof message.type !== "string") return null;
  const own = isOwnPage(sender);
  const trusted = trustedSender(sender);
  if (!own && !trusted) return null;
  const [config, runtime] = await Promise.all([settings(), state()]);
  if (message.type === "status" && own) {
    return {enabled: config.enabled, paused: runtime.paused, hasPassword: Boolean(config.username && config.password),
      hasTotp: Boolean(config.totp), isis: config.isis, moses: config.moses};
  }
  if (message.type === "pause") {
    if (!own && message.reason !== "logout") return null;
    runtime.paused = message.reason === "logout" ? "You logged out. Use Resume when you want automatic login again." : "Paused from the toolbar.";
    await persist(runtime);
    return {ok: true};
  }
  if (message.type === "resume" && own) {
    await browser.storage.local.set({settings: {...config, enabled: true}});
    // Keep the OTP counter: a resume must not reuse an already submitted token.
    await persist({...runtime, paused: "", attempts: []});
    return {ok: true};
  }
  if (message.type === "save" && own) {
    const next = message.settings;
    if (!next || ["enabled", "isis", "moses"].some(k => typeof next[k] !== "boolean") ||
        ["username", "password", "totp"].some(k => typeof next[k] !== "string" || next[k].length > 4096)) {
      throw new Error("Invalid settings.");
    }
    if (next.totp.trim()) parseTotp(next.totp);
    if (Boolean(next.username.trim()) !== Boolean(next.password)) throw new Error("Enter both a username and password, or leave both empty.");
    const sanitized = Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(key => [key, next[key]]));
    await browser.storage.local.set({settings: {...sanitized, username: next.username.trim(), totp: next.totp.trim()}});
    await persist({...runtime, paused: "", attempts: [],
      lastOtpCounter: sanitized.totp.trim() === config.totp ? runtime.lastOtpCounter : -1});
    return {ok: true};
  }
  if (message.type === "forget" && own) {
    await browser.storage.local.remove(SETTINGS_KEY);
    await persist({paused: "Saved credentials removed. Use Resume for SSO-only login.", attempts: [], lastOtpCounter: -1});
    return {ok: true};
  }
  if (!trusted) return null;
  const service = classifyUrl(sender.url);
  const active = config.enabled && !runtime.paused && (service === "idp" || config[service]);
  if (message.type === "check") return {active};
  if (!active) return {ok: false, reason: runtime.paused || "Automatic login is disabled."};
  if (message.type === "success" && service !== "idp") {
    let changed = false;
    for (const attempt of runtime.attempts) {
      if (attempt.tabId === sender.tab.id && !attempt.settled) { attempt.settled = true; changed = true; }
    }
    if (changed) await persist(runtime);
    return {ok: true};
  }
  if (message.type === "failure") {
    runtime.paused = "TU reported a login error. Check the page and your credentials, then use Resume.";
    await persist(runtime);
    return {ok: true};
  }
  if (!["start", "password", "otp"].includes(message.type)) return null;
  if (message.type === "start" ? service === "idp" : service !== "idp") return null;
  if (message.type !== "start" && !safeFormAction(message.action, sender.url)) return null;
  if (message.type === "password" && !(config.username && config.password)) return {ok: false, reason: "Enter your credentials here, or save them in the extension settings."};
  if (message.type === "otp" && !config.totp) return {ok: false, reason: "Enter your current OTP here, or save a TOTP setup secret in settings."};
  const flowUrl = new URL(sender.url);
  // execution identifies Shibboleth's current login step. Never save query strings or SAML messages.
  const flow = service === "idp" ? `${flowUrl.pathname}:${flowUrl.searchParams.get("execution") || "login"}` : `${service}:${flowUrl.pathname}`;
  let token;
  if (message.type === "otp") {
    token = await generateTotp(parseTotp(config.totp));
    if (token.remaining < 4) return {ok: false, retryMs: Math.ceil(token.remaining * 1000) + 150};
    if (token.counter <= runtime.lastOtpCounter) return {ok: false, retryMs: Math.ceil(token.remaining * 1000) + 150};
  }
  const reason = reserveAttempt(runtime, {kind: message.type, tabId: sender.tab.id, flow});
  if (reason) {
    runtime.paused = reason;
    await persist(runtime);
    return {ok: false, reason};
  }
  if (token) runtime.lastOtpCounter = token.counter;
  await persist(runtime);
  if (message.type === "password") return {ok: true, username: config.username, password: config.password};
  if (message.type === "otp") return {ok: true, code: token.code};
  return {ok: true};
}

browser.runtime.onMessage.addListener((message, sender) => {
  const result = queue.then(() => handle(message, sender));
  queue = result.catch(() => {});
  return result.catch(() => ({ok: false, reason: "Could not complete automatic login. Open settings to check your configuration."}));
});
browser.runtime.onInstalled.addListener(async details => {
  await badge();
  if (details.reason === "install") await browser.runtime.openOptionsPage();
});
browser.runtime.onStartup.addListener(() => badge());
