import {test, beforeEach} from "node:test";
import assert from "node:assert/strict";
import {DEFAULT_SETTINGS} from "../extension/lib/policy.js";

const local = {}, session = {};
let listener;
let tabRemoved;
let navigationStarted, tabUpdated;
let installed, started;
const removed = [];
let beforeTabGet;
const tabs = new Map();
let nextTabId = 100;
function area(store) {
  return {get: async key => ({[key]: structuredClone(store[key])}),
    set: async values => Object.assign(store, structuredClone(values)),
    remove: async key => { delete store[key]; }};
}
globalThis.browser = {
  storage: {local: area(local), session: area(session)},
  action: {setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {}},
  alarms: {create: () => {}, onAlarm: {addListener: () => {}}},
  captivePortal: {onStateChanged: {addListener: () => {}}},
  webNavigation: {onBeforeNavigate: {addListener: fn => { navigationStarted = fn; }}},
  tabs: {
    onRemoved: {addListener: fn => { tabRemoved = fn; }},
    onUpdated: {addListener: fn => { tabUpdated = fn; }},
    get: async id => { beforeTabGet?.(id); if (!tabs.has(id)) throw new Error("No such tab"); return {...tabs.get(id)}; },
    remove: async id => { removed.push(id); tabs.delete(id); tabRemoved(id); },
    query: async () => [...tabs.values()].map(tab => ({...tab})),
    create: async properties => { const tab = {...properties, id: nextTabId++}; tabs.set(tab.id, tab); return tab; },
    update: async (id, properties) => { if (!tabs.has(id)) throw new Error("No such tab"); Object.assign(tabs.get(id), properties); return tabs.get(id); }
  },
  runtime: {getURL: path => `moz-extension://test/${path}`, onMessage: {addListener: fn => { listener = fn; }},
    onInstalled: {addListener: fn => { installed = fn; }}, onStartup: {addListener: fn => { started = fn; }}, openOptionsPage: async () => {}}
};
await import("../extension/background.js");
const own = {url: "moz-extension://test/options/options.html"};
const sso = "https://shibboleth.tubit.tu-berlin.de/idp/profile/SAML2/Redirect/SSO?execution=e1s2";
const idp = {url: sso, tab: {id: 1}, frameId: 0};
const isis = {url: "https://isis.tu-berlin.de/login/index.php", tab: {id: 1}, frameId: 0};
const config = {...DEFAULT_SETTINGS, username: "student", password: "test-only-password", totp: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"};
const send = (message, sender = own) => listener(message, sender);
beforeEach(() => {
  for (const key of Object.keys(local)) delete local[key];
  for (const key of Object.keys(session)) delete session[key];
  local.settings = {...config};
  tabs.clear();
  tabs.set(1, {id: 1, url: sso});
  nextTabId = 100;
  removed.length = 0;
  beforeTabGet = null;
});
const guestSuccessUrl = "https://radius-01.tu-berlin.de:8443/portal/AupSubmit.action?from=AUP";
test("guest Success title closes a still-loading background tab without any content-script message", async () => {
  const tab = {id: 3, url: guestSuccessUrl, title: "Success", status: "loading", active: false};
  tabs.set(3, tab);
  session.runtime = {attempts: [{kind: "guest-terms", tabId: 3, flow: "guest:/portal/AupSubmit.action", at: Date.now()}]};
  tabUpdated(3, {title: "Success"}, tab);
  await send({type: "status"});
  assert.deepEqual(removed, [3]);
  assert.equal(session.runtime.attempts[0].settled, true);
});
test("guest login and policy pages remain open, even with a stale Success title on navigation", async () => {
  for (const [url, title, change] of [
    [guestSuccessUrl, "Acceptable Use Policy", {title: "Acceptable Use Policy"}],
    [guestSuccessUrl.replace("AupSubmit", "LoginSubmit"), "Success", {title: "Success"}],
    [guestSuccessUrl.replace(":8443", ""), "Success", {title: "Success"}],
    [guestSuccessUrl, "Success", {url: guestSuccessUrl, status: "loading"}]
  ]) {
    const tab = {id: 3, url, title, status: "loading"}; tabs.set(3, tab);
    tabUpdated(3, change, tab);
    await send({type: "status"});
  }
  assert.deepEqual(removed, []);
});
test("guest auto-close respects the enable switch, guest switch and toolbar pause", async () => {
  for (const setting of ["enabled", "guest", "paused"]) {
    local.settings = {...config}; local.pauseReason = "";
    if (setting === "paused") local.pauseReason = "Paused from the toolbar.";
    else local.settings[setting] = false;
    const tab = {id: 3, url: guestSuccessUrl, title: "Success"}; tabs.set(3, tab);
    tabUpdated(3, {title: "Success"}, tab);
    await send({type: "status"});
  }
  assert.deepEqual(removed, []);
});
test("guest auto-close rechecks the tab after success settlement before removing it", async () => {
  const tab = {id: 3, url: guestSuccessUrl, title: "Success"}; tabs.set(3, tab);
  let reads = 0;
  beforeTabGet = id => { if (id === 3 && ++reads === 2) tabs.set(3, {id: 3, url: "https://isis.tu-berlin.de/", title: "ISIS"}); };
  tabUpdated(3, {title: "Success"}, tab);
  await send({type: "status"});
  assert.deepEqual(removed, []);
});
test("already successful guest tabs close after an extension update or browser startup", async () => {
  for (const event of [() => installed({reason: "update"}), () => started()]) {
    tabs.set(3, {id: 3, url: guestSuccessUrl, title: "Success", status: "loading"});
    local.settings.guestNative = false;
    globalThis.browser.captivePortal.getState = async () => "not_captive";
    await event();
    await send({type: "status"});
    assert.equal(tabs.has(3), false);
    assert.equal(tabs.has(1), true);
  }
  assert.deepEqual(removed, [3, 3]);
});
test("only own extension pages can edit settings or resume", async () => {
  for (const sender of [isis, idp, {url: "https://attacker.test/", tab: {id: 1}, frameId: 0}]) {
    assert.equal(await send({type: "status"}, sender), null);
    assert.equal(await send({type: "save", settings: {...config, password: "different"}}, sender), null);
    assert.equal(await send({type: "resume"}, sender), null);
    assert.equal(await send({type: "forget"}, sender), null);
  }
  assert.equal(local.settings.password, config.password);
});
test("never releases credentials to services, frames, lookalike origins or external actions", async () => {
  for (const sender of [isis, {...idp, frameId: 3}, {...idp, url: sso.replace(".de/", ".de.attacker.test/")}]) {
    assert.equal(await send({type: "password", action: sso}, sender), null);
    assert.equal(await send({type: "otp", action: sso}, sender), null);
  }
  assert.equal(await send({type: "password", action: "https://attacker.test/"}, idp), null);
  const result = await send({type: "password", action: sso}, idp);
  assert.deepEqual(result, {ok: true, username: config.username, password: config.password});
  assert.equal(JSON.stringify(session).includes(config.password), false);
  assert.equal(JSON.stringify(session).includes(config.totp), false);
});
test("ISIS navbar and TU button are separate allowed steps; loops stop", async () => {
  const root = {...isis, url: "https://isis.tu-berlin.de/"};
  assert.equal((await send({type: "start"}, root)).ok, true);
  assert.equal((await send({type: "start"}, isis)).ok, true);
  assert.equal((await send({type: "start"}, isis)).ok, false);
  assert.match((await send({type: "status"})).paused, /already attempted/);
});
test("success settles flow guards so later session expiration can sign in again", async () => {
  await send({type: "start"}, isis);
  await send({type: "password", action: sso}, idp);
  await send({type: "success"}, isis);
  assert.equal((await send({type: "start"}, isis)).ok, true);
  assert.equal((await send({type: "password", action: sso}, idp)).ok, true);
});
test("logout pause survives background and browser restarts until Resume", async () => {
  assert.equal((await send({type: "pause", reason: "logout"}, isis)).ok, true);
  assert.equal((await send({type: "check"}, idp)).active, false);
  delete session.runtime; // Firefox clears storage.session on browser restart.
  assert.equal((await send({type: "check"}, idp)).active, false);
  await send({type: "resume"});
  assert.equal((await send({type: "check"}, idp)).active, true);
});
test("rejected saved credentials pause retries and open the account editor", async () => {
  await send({type: "password", action: sso}, idp);
  assert.equal((await send({type: "check"}, idp)).hasLoginAttempt, true);
  const failed = await send({type: "failure", step: "password", action: sso}, idp);
  assert.equal(failed.paused, true);
  assert.equal(failed.opened, true);
  assert.equal((await send({type: "check"}, isis)).active, false);
  const setup = {url: tabs.get(100).url, tab: {id: 100}};
  assert.equal((await send({type: "setup-info"}, setup)).reason, "rejected");
  await send({type: "setup-save", account: {username: "student", password: "corrected-password", totp: ""}}, setup);
  assert.equal((await send({type: "check"}, idp)).active, true);
  assert.equal((await send({type: "check"}, idp)).hasLoginAttempt, false);
  assert.equal((await send({type: "password", action: sso}, idp)).password, "corrected-password");
});
test("unrelated errors and disabled services cannot pause credential handling", async () => {
  assert.equal(await send({type: "failure"}, isis), null);
  assert.equal((await send({type: "failure", step: "password", action: sso}, idp)).ok, false);
  assert.equal((await send({type: "check"}, isis)).active, true);
  await send({type: "resume"});
  local.settings.isis = false;
  assert.equal((await send({type: "check"}, isis)).active, false);
  assert.equal((await send({type: "check"}, {...idp, tab: {id: 2}})).active, true);
});
const tuportUrl = "https://tuport.sap.tu-berlin.de/";
test("TUport redirects use the saved account followed by a generated TOTP on Shibboleth", async () => {
  navigationStarted({tabId: 1, frameId: 0, url: tuportUrl});
  tabUpdated(1, {url: sso}, {url: sso});
  assert.equal((await send({type: "check"}, idp)).active, true);
  assert.equal((await send({type: "password", action: sso}, idp)).password, config.password);
  tabUpdated(1, {status: "complete"}, {url: sso});
  const otpStep = sso.replace("e1s2", "e1s3");
  const originalNow = Date.now;
  Date.now = () => Math.floor(originalNow() / 30000) * 30000 + 1000;
  try {
    const otp = await send({type: "otp", action: otpStep}, {...idp, url: otpStep});
    assert.match(otp.code, /^\d{6}$/);
    assert.equal(otp.secret, undefined);
    assert.equal(session.runtime.attempts.every(a => !a.settled), true);
    tabUpdated(1, {url: tuportUrl, status: "complete"}, {url: tuportUrl});
    await send({type: "status"});
    assert.equal(session.runtime.attempts.every(a => a.settled), true);
    assert.equal((await send({type: "password", action: sso}, idp)).ok, true);
  } finally { Date.now = originalNow; }
  assert.deepEqual(session.serviceTabs, {1: "tuport"});
  assert.equal(JSON.stringify(session).includes("SAMLRequest"), false);
});
test("TUport's service switch blocks both account and OTP steps after its redirect", async () => {
  local.settings.tuport = false;
  navigationStarted({tabId: 1, frameId: 0, url: tuportUrl});
  tabUpdated(1, {url: sso}, {url: sso});
  assert.equal((await send({type: "check"}, idp)).active, false);
  assert.equal((await send({type: "password", action: sso}, idp)).ok, false);
  assert.equal((await send({type: "otp", action: sso}, idp)).ok, false);
  assert.equal((await send({type: "check"}, {...idp, tab: {id: 2}})).active, true);
  assert.equal(session.runtime, undefined);
  tabUpdated(1, {url: "https://example.org/"}, {url: "https://example.org/"});
  assert.equal((await send({type: "check"}, idp)).active, true);
});
test("TUport inside a frame cannot change the top-level SSO service switch", async () => {
  local.settings.tuport = false;
  navigationStarted({tabId: 1, frameId: 7, url: tuportUrl});
  assert.equal((await send({type: "check"}, idp)).active, true);
  assert.equal(session.serviceTabs, undefined);
});
test("unconfigured TUport opens extension setup on its Shibboleth account form", async () => {
  local.settings = {...DEFAULT_SETTINGS};
  navigationStarted({tabId: 1, frameId: 0, url: tuportUrl});
  const check = await send({type: "check"}, idp);
  assert.equal(check.needsSetup, true);
  assert.equal(check.active, true);
  assert.equal((await send({type: "open-setup", step: "password", action: sso}, idp)).opened, true);
  assert.equal(session.runtime, undefined);
  tabRemoved(1);
  await send({type: "status"});
  assert.equal(session.serviceTabs[1], undefined);
});
test("the SAP host never receives passwords or generated OTPs from extension messages", async () => {
  const sender = {url: tuportUrl, tab: {id: 1}, frameId: 0};
  for (const type of ["password", "otp", "guest-password"]) {
    assert.equal(await send({type, action: tuportUrl}, sender), null);
  }
});
test("OTP waits near expiry and is not reused across tabs or Resume", async () => {
  const original = Date.now;
  Date.now = () => 61000;
  try {
    const token = await send({type: "otp", action: sso}, idp);
    assert.match(token.code, /^\d{6}$/);
    assert.equal(token.secret, undefined);
    await send({type: "resume"});
    assert.ok((await send({type: "otp", action: sso}, {...idp, tab: {id: 2}})).retryMs > 0);
    Date.now = () => 89000;
    assert.ok((await send({type: "otp", action: sso}, idp)).retryMs > 0);
    Date.now = () => 91000;
    assert.equal((await send({type: "otp", action: sso}, {...idp, tab: {id: 2}})).ok, true);
  } finally { Date.now = original; }
});
test("settings validate secrets, only save known keys and delete on request", async () => {
  assert.equal((await send({type: "save", settings: {...config, totp: "123456"}})).ok, false);
  assert.equal((await send({type: "save", settings: {...config, username: ""}})).ok, false);
  assert.equal((await send({type: "save", settings: {...config, unrelated: "no"}})).ok, true);
  assert.equal(local.settings.unrelated, undefined);
  await send({type: "forget"});
  assert.equal(local.settings, undefined);
  assert.ok((await send({type: "status"})).paused);
});
test("changing TOTP configuration clears the old counter; ordinary settings saves retain it", async () => {
  session.runtime = {lastOtpCounter: 10000, attempts: [], paused: ""};
  await send({type: "save", settings: config});
  assert.equal(session.runtime.lastOtpCounter, 10000);
  await send({type: "save", settings: {...config, totp: `otpauth://totp/TU?secret=${config.totp}&period=60`}});
  assert.equal(session.runtime.lastOtpCounter, -1);
});
const guest = {url: "https://radius-01.tu-berlin.de:8443/portal/PortalSetup.action", tab: {id: 3}, frameId: 0};
test("guest credentials and AGB acceptance use independent checked actions and settings", async () => {
  const login = "https://radius-01.tu-berlin.de:8443/portal/LoginSubmit.action?from=LOGIN";
  const aup = "https://radius-01.tu-berlin.de:8443/portal/AupSubmit.action";
  assert.equal((await send({type: "guest-password", action: login}, guest)).password, config.password);
  assert.equal((await send({type: "guest-terms", action: aup}, guest)).ok, true);
  assert.equal(await send({type: "password", action: login}, guest), null);
  assert.equal(await send({type: "guest-password", action: login}, idp), null);
  assert.equal(await send({type: "guest-password", action: "https://attacker.test/portal/LoginSubmit.action"}, guest), null);
  local.settings.acceptGuestTerms = false;
  assert.equal((await send({type: "guest-terms", action: aup}, guest)).ok, false);
  local.settings.guest = false;
  assert.equal((await send({type: "check"}, guest)).active, false);
});
test("guest pages cannot invoke native discovery or retrieve OTPs", async () => {
  assert.equal(await send({type: "discover-guest"}, guest), null);
  assert.equal(await send({type: "otp", action: guest.url}, guest), null);
});
async function openSetup(sender = idp) {
  local.settings = {...DEFAULT_SETTINGS};
  tabs.set(sender.tab.id, {id: sender.tab.id, url: sender.url});
  const action = sender === guest ? "https://radius-01.tu-berlin.de:8443/portal/LoginSubmit.action" : sso;
  await send({type: "open-setup", step: sender === guest ? "guest-password" : "password", action}, sender);
  return {url: tabs.get(100).url, tab: {id: 100}};
}
test("missing credentials open setup only for checked TU authentication steps", async () => {
  local.settings = {...DEFAULT_SETTINGS};
  assert.equal((await send({type: "check"}, idp)).needsSetup, true);
  for (const message of [{type: "open-setup", step: "password", action: "https://attacker.test/"},
    {type: "open-setup", step: "start", action: sso}]) assert.equal(await send(message, idp), null);
  const setup = await openSetup();
  assert.equal((await send({type: "setup-info"}, setup)).canReturn, true);
  assert.equal(await send({type: "setup-info"}, idp), null);
  assert.equal(tabs.size, 2);
  await send({type: "open-setup", step: "password", action: sso}, idp);
  assert.equal(tabs.size, 2);
});
test("ISIS and Moses open first-time setup directly without credential submission", async () => {
  local.settings = {...DEFAULT_SETTINGS};
  for (const sender of [isis, {url: "https://moseskonto.tu-berlin.de/moses/index.html", tab: {id: 2}, frameId: 0}]) {
    tabs.set(sender.tab.id, {id: sender.tab.id, url: sender.url});
    assert.equal((await send({type: "open-setup", step: "start"}, sender)).opened, true);
    assert.equal((await send({type: "check"}, sender)).active, true);
  }
  assert.equal(session.runtime, undefined);
});
test("missing accounts with errors offer setup without pausing, including old erroneous pauses", async () => {
  local.settings = {...DEFAULT_SETTINGS};
  local.pauseReason = "TU reported a login error. Check the page and your credentials, then use Resume.";
  assert.equal((await send({type: "check"}, idp)).active, true);
  assert.equal((await send({type: "failure", step: "password", action: sso}, idp)).opened, true);
  assert.equal((await send({type: "check"}, idp)).active, true);
  assert.equal(local.pauseReason, "");
  assert.equal(local.settings.password, "");
  local.pauseReason = "Paused from the toolbar.";
  assert.equal((await send({type: "check"}, idp)).active, false);
});
test("SSO-only start loops do not globally disable an account that has not been configured", async () => {
  local.settings = {...DEFAULT_SETTINGS};
  await send({type: "start"}, isis);
  assert.equal((await send({type: "start"}, isis)).ok, false);
  assert.equal((await send({type: "check"}, idp)).active, true);
  assert.equal((await send({type: "check"}, idp)).needsSetup, true);
});
test("setup saves the TOTP seed locally, preserves preferences and resumes the TU login", async () => {
  const setup = await openSetup();
  local.settings.acceptGuestTerms = false;
  local.settings.guestNative = false;
  const account = {username: " student ", password: "test-only-password", totp: config.totp};
  assert.deepEqual(await send({type: "setup-save", account}, setup), {ok: true, returned: true});
  assert.equal(local.settings.username, "student");
  assert.equal(local.settings.totp, config.totp);
  assert.equal(local.settings.acceptGuestTerms, false);
  assert.equal(local.settings.guestNative, false);
  assert.equal((await send({type: "check"}, idp)).needsSetup, false);
  assert.equal(tabs.get(1).active, true);
  assert.equal(JSON.stringify(session).includes(account.password), false);
  assert.equal(JSON.stringify(session).includes(account.totp), false);
});
test("setup rejects six-digit codes and missing credentials without saving", async () => {
  const setup = await openSetup();
  for (const account of [
    {username: "student", password: "password", totp: "123456"},
    {username: "", password: "password", totp: ""},
    {username: "student", password: "", totp: ""}
  ]) assert.equal((await send({type: "setup-save", account}, setup)).ok, false);
  assert.equal(local.settings.password, "");
  assert.equal(tabs.get(1).active, undefined);
  assert.equal(await send({type: "setup-save", account: {username: "x", password: "x", totp: ""}}, idp), null);
});
test("skipping setup keeps the account empty and makes manual TU login available", async () => {
  const setup = await openSetup(guest);
  assert.equal((await send({type: "setup-skip"}, setup)).returned, true);
  assert.equal(local.settings.password, "");
  assert.equal((await send({type: "check"}, guest)).needsSetup, false);
  assert.equal((await send({type: "check"}, idp)).needsSetup, true);
});
test("configured or paused accounts never open first-time setup", async () => {
  assert.equal((await send({type: "open-setup", step: "password", action: sso}, idp)).alreadyConfigured, true);
  local.settings = {...DEFAULT_SETTINGS};
  local.pauseReason = "Paused";
  assert.equal((await send({type: "open-setup", step: "password", action: sso}, idp)).ok, false);
  assert.equal(tabs.size, 1);
});
test("closing setup cleans its state and bypasses repeated prompts", async () => {
  const setup = await openSetup();
  tabs.delete(setup.tab.id);
  tabRemoved(setup.tab.id);
  assert.equal((await send({type: "check"}, idp)).needsSetup, false);
});
