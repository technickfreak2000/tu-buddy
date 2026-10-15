import {test, beforeEach} from "node:test";
import assert from "node:assert/strict";

const local = {}, session = {};
let listener;
function area(store) {
  return {get: async key => ({[key]: structuredClone(store[key])}),
    set: async values => Object.assign(store, structuredClone(values)),
    remove: async key => { delete store[key]; }};
}
globalThis.browser = {
  storage: {local: area(local), session: area(session)},
  action: {setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {}},
  runtime: {getURL: path => `moz-extension://test/${path}`, onMessage: {addListener: fn => { listener = fn; }},
    onInstalled: {addListener: () => {}}, onStartup: {addListener: () => {}}, openOptionsPage: async () => {}}
};
await import("../extension/background.js");
const own = {url: "moz-extension://test/options/options.html"};
const sso = "https://shibboleth.tubit.tu-berlin.de/idp/profile/SAML2/Redirect/SSO?execution=e1s2";
const idp = {url: sso, tab: {id: 1}, frameId: 0};
const isis = {url: "https://isis.tu-berlin.de/login/index.php", tab: {id: 1}, frameId: 0};
const config = {enabled: true, isis: true, moses: true, username: "student", password: "test-only-password", totp: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"};
const send = (message, sender = own) => listener(message, sender);
beforeEach(() => {
  for (const key of Object.keys(local)) delete local[key];
  for (const key of Object.keys(session)) delete session[key];
  local.settings = {...config};
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
test("TU errors pause all services; disabled services never start", async () => {
  await send({type: "failure"}, idp);
  assert.equal((await send({type: "check"}, isis)).active, false);
  await send({type: "resume"});
  local.settings.isis = false;
  assert.equal((await send({type: "check"}, isis)).active, false);
  assert.equal((await send({type: "check"}, idp)).active, true);
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
