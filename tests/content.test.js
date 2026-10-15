import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {setTimeout as delay} from "node:timers/promises";
import {JSDOM} from "jsdom";

const adapters = await readFile(new URL("../extension/adapters.js", import.meta.url), "utf8");
const content = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");
const fixture = await readFile(new URL("fixtures/password.html", import.meta.url), "utf8");
const idp = "https://shibboleth.tubit.tu-berlin.de/idp/profile/SAML2/Redirect/SSO?execution=e1s2";

function setup(html = fixture, responder = () => ({ok: true, username: "student", password: "test-only-password"}),
  {url = idp, acceptGuestTerms = true, needsSetup = false, hasLoginAttempt = false} = {}) {
  const dom = new JSDOM(html, {url, runScripts: "outside-only", pretendToBeVisual: true});
  const messages = [], submits = [];
  let onChange, onMessage;
  dom.window.HTMLElement.prototype.getClientRects = function () { return this.hidden ? [] : [{}]; };
  dom.window.browser = {
    runtime: {onMessage: {addListener: fn => { onMessage = fn; }}, sendMessage: async message => {
      messages.push(message);
      return message.type === "check" ? {active: true, acceptGuestTerms,
        hasLoginAttempt: typeof hasLoginAttempt === "function" ? hasLoginAttempt() : hasLoginAttempt,
        needsSetup: typeof needsSetup === "function" ? needsSetup() : needsSetup} : responder(message);
    }},
    storage: {onChanged: {addListener: fn => { onChange = fn; }}}
  };
  dom.window.document.addEventListener("submit", event => {
    event.preventDefault();
    submits.push({submitter: event.submitter, fields: Object.fromEntries(new dom.window.FormData(event.target))});
  });
  dom.window.eval(adapters);
  dom.window.eval(content);
  return {dom, doc: dom.window.document, messages, submits,
    setupFinished: () => onMessage({type: "login-setup-finished"}),
    resume: () => onChange({runtime: {oldValue: {paused: "test"}, newValue: {paused: ""}}}, "session")};
}
async function until(check) {
  for (let i = 0; i < 30; i++) { if (check()) return; await delay(50); }
  assert.ok(check(), "Timed out waiting for content-script action");
}
test("fills and submits using the named Shibboleth submitter, once per form", async () => {
  const p = setup();
  try {
    await until(() => p.submits.length === 1);
    assert.equal(p.submits[0].submitter.name, "_eventId_proceed");
    assert.equal(p.submits[0].fields.j_username, "student");
    assert.equal(p.submits[0].fields.j_password, "test-only-password");
    p.doc.body.append(p.doc.createElement("div"));
    await delay(350);
    assert.equal(p.submits.length, 1);
    p.resume();
    await until(() => p.submits.length === 2);
  } finally { p.dom.window.close(); }
});
test("errors after an automatic attempt open correction before submitting again", async () => {
  const p = setup(fixture.replace("<form ", '<p class="form-error">Incorrect password</p><form '),
    () => ({ok: true, opened: true, paused: true}), {hasLoginAttempt: true});
  try {
    await until(() => p.messages.some(m => m.type === "failure"));
    assert.equal(p.submits.length, 0);
    assert.equal(p.messages.some(m => m.type === "password"), false);
    assert.equal(p.messages.find(m => m.type === "failure").step, "password");
  } finally { p.dom.window.close(); }
});
test("rejects a form whose action changes while credentials are being requested", async () => {
  let p;
  p = setup(fixture, () => {
    p.doc.forms[0].action = "https://attacker.test/";
    return {ok: true, username: "student", password: "test-only-password"};
  });
  try {
    await until(() => p.messages.some(m => m.type === "password"));
    await delay(100);
    assert.equal(p.doc.querySelector('[name="j_password"]').value, "");
    assert.equal(p.submits.length, 0);
  } finally { p.dom.window.close(); }
});
test("never obtains another OTP before the requested wait elapses", async () => {
  const otpHtml = await readFile(new URL("fixtures/otp.html", import.meta.url), "utf8");
  let attempts = 0;
  const p = setup(otpHtml, () => (++attempts === 1 ? {ok: false, retryMs: 600} : {ok: true, code: "654321"}));
  try {
    await until(() => attempts === 1);
    await delay(300);
    assert.equal(attempts, 1);
    await until(() => p.submits.length === 1);
    assert.equal(p.submits[0].fields.j_tokenNumber, "654321");
  } finally { p.dom.window.close(); }
});
const guestUrl = "https://radius-01.tu-berlin.de:8443/portal/PortalSetup.action";
test("guest login fills the verified fields and preserves the portal's CSRF token", async () => {
  const html = await readFile(new URL("fixtures/guest-login.html", import.meta.url), "utf8");
  const p = setup(html, undefined, {url: guestUrl});
  try {
    await until(() => p.submits.length === 1);
    assert.equal(p.submits[0].fields["user.username"], "student");
    assert.equal(p.submits[0].fields["user.password"], "test-only-password");
    assert.equal(p.submits[0].fields.token, "fixture-only");
    assert.equal(p.messages.some(m => m.type === "guest-password"), true);
  } finally { p.dom.window.close(); }
});
test("guest terms set Cisco's acceptance field and never choose Decline", async () => {
  const html = await readFile(new URL("fixtures/guest-terms.html", import.meta.url), "utf8");
  const p = setup(html, () => ({ok: true}), {url: guestUrl});
  let declined = false;
  p.doc.querySelector('#ui_aup_decline_button').addEventListener("click", () => { declined = true; });
  p.doc.querySelector('#ui_aup_accept_button').addEventListener("click", () => {
    p.doc.querySelector('#aupAccepted').value = "true";
    p.doc.forms[0].requestSubmit();
  });
  try {
    await until(() => p.submits.length === 1);
    assert.equal(p.submits[0].fields.aupAccepted, "true");
    assert.equal(declined, false);
  } finally { p.dom.window.close(); }
});
test("guest terms stay manual when automatic acceptance is disabled", async () => {
  const html = await readFile(new URL("fixtures/guest-terms.html", import.meta.url), "utf8");
  const p = setup(html, undefined, {url: guestUrl, acceptGuestTerms: false});
  try {
    await until(() => p.doc.querySelector('[role="status"]'));
    assert.equal(p.messages.some(m => m.type === "guest-terms"), false);
    assert.equal(p.submits.length, 0);
  } finally { p.dom.window.close(); }
});
test("guest AGB accepts with the scroll gate still locked and no page handlers", async () => {
  const html = await readFile(new URL("fixtures/guest-terms.html", import.meta.url), "utf8");
  const p = setup(html, () => ({ok: true}), {url: guestUrl});
  const button = p.doc.querySelector('#ui_aup_accept_button');
  button.disabled = true;
  try {
    await until(() => p.submits.length === 1);
    assert.equal(button.disabled, true);
    assert.equal(p.submits[0].fields.aupAccepted, "true");
    assert.equal(p.messages.filter(m => m.type === "guest-terms").length, 1);
  } finally { p.dom.window.close(); }
});
test("missing credentials open setup even on an existing login error", async () => {
  const p = setup(fixture.replace("<form ", '<p class="form-error">Incorrect password</p><form '),
    () => ({ok: true, opened: true}), {needsSetup: true});
  try {
    await until(() => p.messages.some(m => m.type === "open-setup"));
    assert.equal(p.messages.some(m => m.type === "failure"), false);
    assert.equal(p.submits.length, 0);
  } finally { p.dom.window.close(); }
});
test("ISIS and Moses login controls offer account setup before starting SSO", async () => {
  for (const [url, html] of [
    ["https://isis.tu-berlin.de/login/index.php", await readFile(new URL("fixtures/isis.html", import.meta.url), "utf8")],
    ["https://moseskonto.tu-berlin.de/moses/index.html", '<a class="nav-top-user-login" href="#">Login</a>']
  ]) {
    const p = setup(html, () => ({ok: true, opened: true}), {url, needsSetup: true});
    try {
      await until(() => p.messages.some(m => m.type === "open-setup"));
      assert.equal(p.messages.find(m => m.type === "open-setup").step, "start");
      assert.equal(p.messages.some(m => m.type === "start"), false);
    } finally { p.dom.window.close(); }
  }
});
test("stale errors allow a fresh attempt; a new error response stops even on the same form", async () => {
  let submitted = false;
  const p = setup(fixture.replace("<form ", '<p class="form-error">Incorrect password</p><form '),
    message => {
      if (message.type === "password") { submitted = true; return {ok: true, username: "student", password: "corrected"}; }
      return {ok: true, opened: true, paused: true};
    }, {hasLoginAttempt: () => submitted});
  try {
    await until(() => p.submits.length === 1);
    p.doc.body.append(p.doc.createElement("div"));
    await delay(350);
    assert.equal(p.messages.some(m => m.type === "failure"), false);
    const replacement = p.doc.createElement("p");
    replacement.className = "form-error";
    replacement.textContent = "Incorrect password";
    p.doc.querySelector(".form-error").replaceWith(replacement);
    await until(() => p.messages.some(m => m.type === "failure"));
    assert.equal(p.submits.length, 1);
  } finally { p.dom.window.close(); }
});
test("saving after rejection retries the retained form without relying on a settings-change event", async () => {
  let hasLoginAttempt = false;
  const p = setup(fixture, message => {
    if (message.type === "password") { hasLoginAttempt = true; return {ok: true, username: "student", password: "corrected"}; }
    return {ok: true, opened: true, paused: true};
  }, {hasLoginAttempt: () => hasLoginAttempt});
  try {
    await until(() => p.submits.length === 1);
    const error = p.doc.createElement("p");
    error.className = "form-error"; error.textContent = "Incorrect password";
    p.doc.body.append(error);
    await until(() => p.messages.some(m => m.type === "failure"));
    hasLoginAttempt = false; // setup-save clears attempts before waking the original tab.
    p.setupFinished();
    await until(() => p.submits.length === 2);
    await delay(350);
    assert.equal(p.messages.filter(m => m.type === "failure").length, 1);
  } finally { p.dom.window.close(); }
});
test("first-time TU login opens setup before requesting or submitting any credentials", async () => {
  const p = setup(fixture, () => ({ok: true, opened: true}), {needsSetup: true});
  try {
    await until(() => p.messages.some(m => m.type === "open-setup"));
    assert.equal(p.messages.find(m => m.type === "open-setup").step, "password");
    assert.equal(p.messages.some(m => m.type === "password"), false);
    assert.equal(p.submits.length, 0);
    p.doc.body.append(p.doc.createElement("div"));
    await delay(350);
    assert.equal(p.messages.filter(m => m.type === "open-setup").length, 1);
  } finally { p.dom.window.close(); }
});
test("guest login opens the same extension setup flow when the account is missing", async () => {
  const html = await readFile(new URL("fixtures/guest-login.html", import.meta.url), "utf8");
  const p = setup(html, () => ({ok: true, opened: true}), {url: guestUrl, needsSetup: true});
  try {
    await until(() => p.messages.some(m => m.type === "open-setup"));
    assert.equal(p.messages.find(m => m.type === "open-setup").step, "guest-password");
    assert.equal(p.submits.length, 0);
  } finally { p.dom.window.close(); }
});
test("a direct completion message wakes the original tab without session-storage events", async () => {
  let needsSetup = true;
  const p = setup(fixture, message => {
    if (message.type === "open-setup") return {ok: true, opened: true};
    return {ok: false, reason: "Enter your credentials manually."};
  }, {needsSetup: () => needsSetup});
  try {
    await until(() => p.messages.some(m => m.type === "open-setup"));
    needsSetup = false;
    p.setupFinished();
    await until(() => p.messages.some(m => m.type === "password"));
    assert.equal(p.messages.filter(m => m.type === "open-setup").length, 1);
    assert.equal(p.submits.length, 0);
  } finally { p.dom.window.close(); }
});
