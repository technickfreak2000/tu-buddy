import {test} from "node:test";
import assert from "node:assert/strict";
import {createGuestDiscovery, safePortalUrl} from "../extension/lib/guest-discovery.js";

const url = "https://radius-01.tu-berlin.de:8443/portal/gateway?portal=26d19560-2e58-11e9-98fb-0050568775a3&sessionId=fixture-only";
function setup({helper = {}, captive = "not_captive", enabled = true, paused = false,
  canonical = "http://firefox-portal-detection.com/generate_204"} = {}) {
  const data = {}, tabs = [], requests = [];
  const config = {enabled, guest: true, guestNative: true};
  let nativeResult = helper;
  const api = {
    storage: {session: {
      get: async key => ({[key]: data[key]}), set: async value => Object.assign(data, value), remove: async key => delete data[key]
    }},
    runtime: {sendNativeMessage: async (host, request) => {
      requests.push({host, request});
      if (nativeResult instanceof Error) throw nativeResult;
      return nativeResult;
    }},
    captivePortal: {getState: async () => captive, canonicalURL: canonical},
    tabs: {create: async tab => tabs.push(tab)}
  };
  return {scan: createGuestDiscovery(api, async () => config, async () => paused), data, tabs, requests, config,
    native: value => { nativeResult = value; }};
}
test("only TU's exact portal, port and fresh session redirect is trusted", () => {
  assert.equal(safePortalUrl(url), true);
  for (const bad of [url.replace(":8443", ""), url.replace("https:", "http:"), url.replace(".de:", ".de.attacker.test:"),
    url.replace("fixture-only", ""), url.replace("26d19560", "wrong-id"), url.replace("gateway", "Logout.action")]) assert.equal(safePortalUrl(bad), false);
});
test("second-adapter discovery opens the fresh URL and stores no portal session tokens", async () => {
  const p = setup({helper: {connected: true, interface: "wlan3", networkId: "connection-1", url}});
  assert.match((await p.scan()).reason, /wlan3/);
  assert.equal(p.tabs[0].url, url);
  assert.equal(JSON.stringify(p.data).includes("fixture-only"), false);
  assert.deepEqual(Object.keys(p.requests[0].request).sort(), ["action", "previousNetwork"]);
  p.native({connected: true, unchanged: true});
  await p.scan();
  assert.equal(p.tabs.length, 1);
  p.native({connected: true, interface: "wlan7", networkId: "connection-2", url});
  await p.scan();
  assert.equal(p.tabs.length, 2);
});
test("native discovery rejects unrelated redirects, disabled operation and pauses", async () => {
  const p = setup({helper: {connected: true, url: "https://attacker.test/"}});
  assert.equal((await p.scan()).ok, false);
  assert.equal(p.tabs.length, 0);
  for (const options of [{enabled: false}, {paused: true}]) {
    const blocked = setup(options); await blocked.scan(); assert.equal(blocked.requests.length, 0);
  }
});
test("browser-only fallback opens a credential-free detection tab once per captive episode", async () => {
  const p = setup({helper: new Error("Host not installed"), captive: "locked_portal"});
  await p.scan(); await p.scan();
  assert.equal(p.tabs.length, 1);
  assert.equal(p.tabs[0].url, "http://firefox-portal-detection.com/generate_204");
  const absent = setup({helper: new Error("Host not installed")});
  assert.match((await absent.scan(true)).reason, /Linux network helper/);
  assert.equal(absent.tabs.length, 0);
});
test("simultaneous scans do not open duplicate portal tabs", async () => {
  const p = setup({helper: {connected: true, interface: "wlan3", networkId: "connection-1", url}});
  await Promise.all([p.scan(), p.scan(), p.scan()]);
  assert.equal(p.tabs.length, 1);
});
test("Firefox's canonicalURL BrowserSetting is resolved through its get method", async () => {
  const p = setup({helper: new Error("Host not installed"), captive: "locked_portal",
    canonical: {get: async () => ({value: "http://detectportal.firefox.com/canonical.html"})}});
  assert.equal((await p.scan()).ok, true);
  assert.equal(p.tabs[0].url, "http://detectportal.firefox.com/canonical.html");
});
