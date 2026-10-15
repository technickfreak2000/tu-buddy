import {GUEST_ORIGIN, GUEST_PORTAL} from "./policy.js";

export const NATIVE_HOST = "de.tu_berlin.tu_buddy";
export const GUEST_ALARM = "tu-guest-network";

export function safePortalUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === GUEST_ORIGIN && !url.username && !url.password && !url.hash &&
      ["/portal/gateway", "/portal/PortalSetup.action", "/portal/Login.action"].includes(url.pathname) &&
      url.searchParams.get("portal") === GUEST_PORTAL && Boolean(url.searchParams.get("sessionId"));
  } catch { return false; }
}

export function createGuestDiscovery(api, getConfig, isPaused) {
  let pending;
  async function scan(force = false) {
    const config = await getConfig();
    if (!config.enabled || !config.guest || await isPaused()) return {ok: false, reason: "Guest auto-login is disabled or paused."};
    const stored = await api.storage.session.get("guestDiscovery");
    const previous = stored.guestDiscovery || {};
    if (config.guestNative) {
      try {
        const result = await api.runtime.sendNativeMessage(NATIVE_HOST,
          {action: "discover", previousNetwork: force ? "" : previous.networkId || ""});
        if (result.connected && result.unchanged) return {ok: true, reason: "TUB-Guest connection already checked."};
        if (result.connected && safePortalUrl(result.url)) {
          // Never persist the portal URL: it contains a live network session token.
          if (!(await getConfig()).enabled || !(await getConfig()).guest || await isPaused()) return {ok: false};
          await api.tabs.create({url: result.url, active: true});
          await api.storage.session.set({guestDiscovery: {networkId: result.networkId}});
          return {ok: true, reason: `Opened TUB-Guest login on ${result.interface}.`};
        }
        if (result.connected && result.online) {
          await api.storage.session.set({guestDiscovery: {networkId: result.networkId}});
          return {ok: true, reason: "TUB-Guest already has internet access."};
        }
        if (!result.connected) await api.storage.session.remove("guestDiscovery");
        if (!result.connected && result.reason) return {ok: false, reason: result.reason};
        if (result.connected) return {ok: false, reason: result.reason || "TUB-Guest is connected, but no trusted login redirect was returned."};
        if (!force) return {ok: true, reason: "TUB-Guest is not connected."};
      } catch {
        // Browser-only mode continues to work without the optional Linux helper.
        if (force && await api.captivePortal.getState() !== "locked_portal") {
          return {ok: false, reason: "Install the Linux network helper to detect a second Wi-Fi adapter. Firefox has not detected a captive portal on its normal route."};
        }
      }
    }
    if (await api.captivePortal.getState() !== "locked_portal") return {ok: true, reason: "Firefox has not detected a captive portal."};
    if (!force && previous.browserOpened) return {ok: true};
    const setting = api.captivePortal.canonicalURL;
    const canonical = typeof setting === "string" ? setting : (await setting?.get({}))?.value;
    if (typeof canonical !== "string" || !/^http:\/\//.test(canonical)) return {ok: false, reason: "Firefox's captive-portal probe URL is unavailable."};
    // This tab contains no credentials. Autofill starts only after it reaches the pinned TU portal.
    await api.tabs.create({url: canonical, active: true});
    await api.storage.session.set({guestDiscovery: {...previous, browserOpened: true}});
    return {ok: true, reason: "Opened Firefox's network login page."};
  }
  return force => {
    if (!pending) pending = scan(force).finally(() => { pending = null; });
    return pending;
  };
}
