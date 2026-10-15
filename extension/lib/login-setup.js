import {classifyUrl} from "./policy.js";

const REQUESTS = "loginSetupRequests";
const BYPASS = "loginSetupBypass";
const MAX_AGE = 30 * 60 * 1000;

export function setupRequestId(url, base) {
  if (url === base) return "";
  if (typeof url !== "string" || !url.startsWith(base + "?")) return null;
  try {
    const parsed = new URL(url);
    const entries = [...parsed.searchParams];
    const id = parsed.searchParams.get("request");
    return !parsed.hash && entries.length === 1 && entries[0][0] === "request" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || "") ? id : null;
  } catch { return null; }
}

export function createLoginSetup(api) {
  const base = api.runtime.getURL("login/login.html");
  async function requests() {
    const stored = (await api.storage.session.get(REQUESTS))[REQUESTS] || [];
    return stored.filter(item => Date.now() - item.created < MAX_AGE);
  }
  async function bypassed(tabId) {
    return ((await api.storage.session.get(BYPASS))[BYPASS] || []).includes(tabId);
  }
  async function bypass(tabId) {
    const ids = (await api.storage.session.get(BYPASS))[BYPASS] || [];
    if (!ids.includes(tabId)) await api.storage.session.set({[BYPASS]: [...ids, tabId]});
  }
  async function requestFor(sender) {
    const id = setupRequestId(sender.url, base);
    if (!id) return null;
    return (await requests()).find(item => item.id === id && item.setupTabId === sender.tab?.id) || null;
  }
  async function sourceTab(request) {
    if (!request) return null;
    try {
      const tab = await api.tabs.get(request.sourceTabId);
      const url = new URL(tab.url);
      return classifyUrl(tab.url) === request.service && url.origin === request.origin && url.pathname === request.path ? tab : null;
    } catch { return null; }
  }
  async function wakeSource(tabId) {
    try { await api.tabs.sendMessage(tabId, {type: "login-setup-finished"}); }
    catch { /* The login document may have navigated or closed. */ }
  }
  async function open(sender) {
    if (await bypassed(sender.tab.id)) return {ok: false, skipped: true};
    const pending = await requests();
    const existing = pending.find(item => item.sourceTabId === sender.tab.id);
    if (existing) {
      try {
        const tab = await api.tabs.get(existing.setupTabId);
        if (tab.url === base + "?request=" + existing.id) {
          await api.tabs.update(tab.id, {active: true});
          return {ok: true, opened: true};
        }
      } catch { /* The setup tab was closed; create a fresh request. */ }
    }
    const source = new URL(sender.url);
    const item = {id: crypto.randomUUID(), sourceTabId: sender.tab.id, service: classifyUrl(sender.url),
      origin: source.origin, path: source.pathname, created: Date.now()};
    // The page URL carries only a random request ID. SAML, portal tokens and secrets stay out of it.
    const properties = {url: base + "?request=" + item.id, active: true};
    if (Number.isInteger(sender.tab.windowId)) properties.windowId = sender.tab.windowId;
    const tab = await api.tabs.create(properties);
    item.setupTabId = tab.id;
    await api.storage.session.set({[REQUESTS]: [...pending.filter(row => row.sourceTabId !== item.sourceTabId), item]});
    return {ok: true, opened: true};
  }
  async function info(sender) {
    const request = await requestFor(sender);
    return {service: request?.service || "", canReturn: Boolean(await sourceTab(request))};
  }
  async function finish(sender, skip = false) {
    const request = await requestFor(sender);
    if (!request) return {returned: false};
    if (skip) await bypass(request.sourceTabId);
    const tab = await sourceTab(request);
    await api.storage.session.set({[REQUESTS]: (await requests()).filter(row => row.id !== request.id)});
    if (tab) {
      try {
        await wakeSource(tab.id);
        await api.tabs.update(tab.id, {active: true});
        return {returned: true};
      } catch { /* The source tab may have closed while saving. */ }
    }
    return {returned: false};
  }
  async function closed(tabId) {
    const pending = await requests();
    for (const item of pending) {
      if (item.setupTabId === tabId) {
        await bypass(item.sourceTabId);
        await wakeSource(item.sourceTabId);
      }
    }
    await api.storage.session.set({[REQUESTS]: pending.filter(item => item.setupTabId !== tabId && item.sourceTabId !== tabId)});
    // Tab IDs can be reused after restart; bypasses are session-scoped and cleaned on close.
    const ids = (await api.storage.session.get(BYPASS))[BYPASS] || [];
    if (ids.includes(tabId)) await api.storage.session.set({[BYPASS]: ids.filter(id => id !== tabId)});
  }
  return {open, info, finish, bypassed, closed, isPage: sender => setupRequestId(sender.url, base) !== null};
}
