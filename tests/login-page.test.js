import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {setTimeout as delay} from "node:timers/promises";
import {JSDOM} from "jsdom";
import {parseTotp, generateTotp} from "../extension/lib/totp.js";

const html = await readFile(new URL("../extension/login/login.html", import.meta.url), "utf8");
const script = (await readFile(new URL("../extension/login/login.js", import.meta.url), "utf8")).replace(/^import[^\n]+\n/, "");
const seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
function setup(responder = () => ({ok: true, returned: true})) {
  const dom = new JSDOM(html, {url: "moz-extension://test/login/login.html", runScripts: "outside-only"});
  const messages = [], closed = [];
  dom.window.parseTotp = parseTotp;
  dom.window.generateTotp = generateTotp;
  dom.window.browser = {
    runtime: {getURL: path => "moz-extension://test/" + path, sendMessage: async message => {
      messages.push(message);
      return message.type === "setup-info" ? {username: "", service: "idp", canReturn: true, hasTotp: false} : responder(message);
    }},
    tabs: {getCurrent: async () => ({id: 100}), remove: async id => closed.push(id)}
  };
  dom.window.eval(script);
  const doc = dom.window.document;
  return {dom, doc, messages, closed, submit: () => doc.querySelector("form").dispatchEvent(new dom.window.Event("submit", {bubbles: true, cancelable: true}))};
}
async function until(check) {
  for (let i = 0; i < 30; i++) { if (check()) return; await delay(20); }
  assert.ok(check(), "Timed out waiting for setup UI");
}
function fill(p, totp = seed) {
  p.doc.getElementById("username").value = "student";
  p.doc.getElementById("password").value = "test-only-password";
  p.doc.getElementById("totp").value = totp;
}
test("dedicated setup submits the TOTP secret and clears secret fields after returning", async () => {
  const p = setup();
  try {
    await until(() => p.doc.getElementById("destination").hidden === false);
    fill(p); p.submit();
    await until(() => p.closed.length === 1);
    assert.deepEqual(JSON.parse(JSON.stringify(p.messages.find(m => m.type === "setup-save").account)),
      {username: "student", password: "test-only-password", totp: seed});
    assert.equal(p.doc.getElementById("password").value, "");
    assert.equal(p.doc.getElementById("totp").value, "");
    assert.equal(p.dom.window.location.href.includes(seed), false);
  } finally { p.dom.window.close(); }
});
test("six-digit codes and missing credentials are rejected before storage", async () => {
  const p = setup();
  try {
    await delay(0); fill(p, "123456"); p.submit();
    await until(() => p.doc.getElementById("status").dataset.error === "true");
    assert.match(p.doc.getElementById("status").textContent, /secret|six-digit/i);
    assert.equal(p.messages.some(m => m.type === "setup-save"), false);
    fill(p); p.doc.getElementById("username").value = " "; p.submit();
    await until(() => /username and password/.test(p.doc.getElementById("status").textContent));
    assert.equal(p.messages.some(m => m.type === "setup-save"), false);
  } finally { p.dom.window.close(); }
});
test("skipping sends no account details and closes setup after restoring TU login", async () => {
  const p = setup();
  try {
    await delay(0); fill(p);
    p.doc.getElementById("skip").click();
    await until(() => p.closed.length === 1);
    assert.equal(p.messages.some(m => m.type === "setup-save"), false);
    assert.deepEqual(JSON.parse(JSON.stringify(p.messages.find(m => m.type === "setup-skip"))), {type: "setup-skip"});
    assert.equal(p.doc.getElementById("totp").value, "");
  } finally { p.dom.window.close(); }
});
test("OTP preview is generated locally and cleared when the seed is edited", async () => {
  const p = setup();
  try {
    await delay(0); fill(p);
    p.doc.getElementById("preview").click();
    await until(() => /^\d{6}/.test(p.doc.getElementById("code").textContent));
    assert.equal(p.messages.some(m => m.type !== "setup-info"), false);
    p.doc.getElementById("totp").dispatchEvent(new p.dom.window.Event("input", {bubbles: true}));
    assert.equal(p.doc.getElementById("code").textContent, "");
  } finally { p.dom.window.close(); }
});
