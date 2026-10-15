import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {setTimeout as delay} from "node:timers/promises";
import {JSDOM} from "jsdom";

const adapters = await readFile(new URL("../extension/adapters.js", import.meta.url), "utf8");
const content = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");
const fixture = await readFile(new URL("fixtures/password.html", import.meta.url), "utf8");
const idp = "https://shibboleth.tubit.tu-berlin.de/idp/profile/SAML2/Redirect/SSO?execution=e1s2";

function setup(html = fixture, responder = () => ({ok: true, username: "student", password: "test-only-password"})) {
  const dom = new JSDOM(html, {url: idp, runScripts: "outside-only", pretendToBeVisual: true});
  const messages = [], submits = [];
  let onChange;
  dom.window.HTMLElement.prototype.getClientRects = function () { return this.hidden || this.disabled ? [] : [{}]; };
  dom.window.browser = {
    runtime: {sendMessage: async message => {
      messages.push(message);
      return message.type === "check" ? {active: true} : responder(message);
    }},
    storage: {onChanged: {addListener: fn => { onChange = fn; }}}
  };
  dom.window.document.addEventListener("submit", event => {
    event.preventDefault();
    submits.push({submitter: event.submitter, fields: Object.fromEntries(new dom.window.FormData(event.target))});
  });
  dom.window.eval(adapters);
  dom.window.eval(content);
  return {dom, doc: dom.window.document, messages, submits, resume: () => onChange({runtime: {oldValue: {paused: "test"}, newValue: {paused: ""}}}, "session")};
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
test("error pages pause and do not submit credentials", async () => {
  const p = setup(fixture.replace("<form ", '<p class="form-error">Incorrect password</p><form '));
  try {
    await until(() => p.messages.some(m => m.type === "failure"));
    assert.equal(p.submits.length, 0);
    assert.equal(p.messages.some(m => m.type === "password"), false);
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
