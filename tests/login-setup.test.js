import {test} from "node:test";
import assert from "node:assert/strict";
import {createLoginSetup, setupRequestId} from "../extension/lib/login-setup.js";

const base = "moz-extension://test/login/login.html";
const sso = "https://shibboleth.tubit.tu-berlin.de/idp/profile/SAML2/Redirect/SSO?execution=e1s2&SAMLRequest=do-not-store";
const sender = {url: sso, tab: {id: 1, windowId: 2}};
function setup() {
  const data = {}, tabs = new Map([[1, {id: 1, url: sso}]]), updates = [], messages = [];
  let nextId = 10;
  const api = {
    runtime: {getURL: path => "moz-extension://test/" + path},
    storage: {session: {
      get: async key => ({[key]: data[key]}), set: async values => Object.assign(data, structuredClone(values))
    }},
    tabs: {
      get: async id => { if (!tabs.has(id)) throw new Error("closed"); return tabs.get(id); },
      create: async properties => { const tab = {id: nextId++, ...properties}; tabs.set(tab.id, tab); return tab; },
      sendMessage: async (tabId, message) => messages.push({tabId, message}),
      update: async (id, properties) => { if (!tabs.has(id)) throw new Error("closed"); updates.push(id); Object.assign(tabs.get(id), properties); }
    }
  };
  const flow = createLoginSetup(api);
  const page = () => ({url: tabs.get(10).url, tab: {id: 10}});
  return {flow, tabs, data, updates, messages, page};
}
test("setup URLs accept only the extension's exact page and a random request ID", () => {
  assert.equal(setupRequestId(base, base), "");
  const id = "12345678-1234-1234-1234-123456789abc";
  assert.equal(setupRequestId(base + "?request=" + id, base), id);
  for (const invalid of [base + "?return=https://attacker.test", base + "?request=" + id + "&url=bad", base + "?request=bad",
    base + "?request=" + id + "#extra", "https://attacker.test/login/login.html?request=" + id]) {
    assert.equal(setupRequestId(invalid, base), null);
  }
});
test("opens a separate extension page in the same window and retains the original SSO request", async () => {
  const p = setup();
  assert.equal((await p.flow.open(sender)).opened, true);
  assert.equal(p.tabs.get(10).windowId, 2);
  assert.equal(p.tabs.get(1).url, sso);
  assert.equal(p.tabs.get(10).url.startsWith(base + "?request="), true);
  assert.equal(JSON.stringify(p.data).includes("SAMLRequest"), false);
  assert.equal(JSON.stringify(p.data).includes("do-not-store"), false);
  assert.equal((await p.flow.info(p.page())).canReturn, true);
  await p.flow.open(sender);
  assert.equal(p.tabs.size, 2);
});
test("saving returns to the retained TU tab; copied request URLs cannot control it", async () => {
  const p = setup();
  await p.flow.open(sender);
  assert.equal((await p.flow.info({...p.page(), tab: {id: 999}})).canReturn, false);
  assert.equal((await p.flow.finish({...p.page(), tab: {id: 999}})).returned, false);
  assert.equal((await p.flow.finish(p.page())).returned, true);
  assert.equal(p.updates.at(-1), 1);
  assert.deepEqual(p.messages, [{tabId: 1, message: {type: "login-setup-finished"}}]);
  assert.deepEqual(p.data.loginSetupRequests, []);
});
test("skipping or closing setup suppresses prompts for the source tab this browser session", async () => {
  for (const close of [false, true]) {
    const p = setup();
    await p.flow.open(sender);
    if (close) { p.tabs.delete(10); await p.flow.closed(10); }
    else await p.flow.finish(p.page(), true);
    assert.equal(await p.flow.bypassed(1), true);
    assert.equal((await p.flow.open(sender)).skipped, true);
    await p.flow.closed(1);
    assert.equal(await p.flow.bypassed(1), false);
  }
});
test("closed or navigated source tabs do not become arbitrary return destinations", async () => {
  for (const action of [p => p.tabs.delete(1), p => { p.tabs.get(1).url = "https://attacker.test/"; }]) {
    const p = setup(); await p.flow.open(sender); action(p);
    assert.equal((await p.flow.info(p.page())).canReturn, false);
    assert.equal((await p.flow.finish(p.page())).returned, false);
    assert.equal(p.updates.length, 0);
  }
});
