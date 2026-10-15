import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";

const script = await readFile(new URL("../extension/adapters.js", import.meta.url), "utf8");
const idp = "https://shibboleth.tubit.tu-berlin.de/idp/profile/SAML2/Redirect/SSO?execution=e1s2";
async function page(fixture, url = idp) {
  const html = fixture.endsWith(".html") ? await readFile(new URL(`fixtures/${fixture}`, import.meta.url), "utf8") : fixture;
  const dom = new JSDOM(html, {url, runScripts: "outside-only", pretendToBeVisual: true});
  // jsdom has no layout. Emulate visibility while still honoring hidden ancestors.
  dom.window.HTMLElement.prototype.getClientRects = function () {
    return this.closest('[hidden], [style*="display: none"], [style*="display:none"]') || this.type === "hidden" ? [] : [{}];
  };
  dom.window.eval(script);
  return {dom, doc: dom.window.document, api: dom.window.TuLoginAdapters, plan: () => dom.window.TuLoginAdapters.plan(dom.window.document, url)};
}
test("ISIS chooses TU-Login, never guest or invited-account login", async () => {
  const {plan, doc} = await page("isis.html", "https://isis.tu-berlin.de/login/index.php");
  assert.equal(plan().button.id, "shibbolethbutton");
  doc.querySelector("#shibbolethbutton").hidden = true;
  assert.equal(plan(), null);
});
test("logged-in services remain undisturbed", async () => {
  const {plan, doc} = await page("isis.html", "https://isis.tu-berlin.de/login/index.php");
  doc.body.classList.add("loggedin");
  assert.equal(plan(), null);
});
test("ISIS follows the navbar login link through Moodle to preserve the destination", async () => {
  const {plan} = await page('<div class="logininfo"><a href="/login/index.php">Login</a></div>', "https://isis.tu-berlin.de/course/view.php?id=42");
  assert.equal(plan().button.href, "https://isis.tu-berlin.de/login/index.php");
});
test("Moses follows its dynamic Vue login control", async () => {
  const {plan, doc} = await page('<nav id="nav-top"></nav>', "https://moseskonto.tu-berlin.de/moses/index.html");
  assert.equal(plan(), null);
  doc.querySelector("nav").innerHTML = '<a class="nav-top-user-login" href="#">Login</a>';
  assert.equal(plan().kind, "start");
  doc.querySelector("nav").innerHTML += '<a class="nav-top-user-logout" href="#">Logout</a>';
  assert.equal(plan(), null);
});
test("matches the inspected Shibboleth username/password form and named submitter", async () => {
  const {plan} = await page("password.html");
  assert.equal(plan().kind, "password");
  assert.equal(plan().username.name, "j_username");
  assert.equal(plan().password.name, "j_password");
  assert.equal(plan().button.name, "_eventId_proceed");
});
test("rejects external actions, submitter overrides, non-POST, hidden or disabled login buttons", async () => {
  for (const change of [
    doc => doc.forms[0].action = "https://attacker.test/",
    doc => doc.forms[0].action = "/pwr-reset.html",
    doc => doc.forms[0].method = "get",
    doc => doc.querySelector("button").setAttribute("formaction", "https://attacker.test/"),
    doc => doc.querySelector("button").setAttribute("formmethod", "get"),
    doc => doc.querySelector("button").setAttribute("formtarget", "_blank"),
    doc => doc.querySelector("button").disabled = true,
    doc => doc.querySelector("button").hidden = true
  ]) {
    const {plan, doc} = await page("password.html");
    change(doc); assert.equal(plan(), null);
  }
});
test("detects TOTP but leaves TAN lists, consent, reset and token-enrollment forms alone", async () => {
  const {plan, doc} = await page("otp.html");
  assert.equal(plan().kind, "otp");
  doc.querySelector("label").textContent = "Enter TAN number 24 from your TAN-Liste";
  assert.equal(plan(), null);
  for (const html of ['<form method="post"><input name="newPassword"><button name="_eventId_proceed">Change</button></form>',
    '<form method="post"><input name="consent"><button name="_eventId_proceed">Accept</button></form>',
    '<form method="post"><input name="setupToken"><button name="_eventId_proceed">Enroll</button></form>']) {
    assert.equal((await page(html)).plan(), null);
  }
});
test("login errors and logout controls are recognized", async () => {
  const {api, doc} = await page('<p class="form-error">Incorrect password</p><a id="out" href="/idp/profile/Logout">Logout</a>');
  assert.equal(api.loginError(doc), true);
  assert.equal(api.isLogout(doc.querySelector("#out"), idp), true);
  doc.querySelector("p").textContent = "Your ZECM team";
  assert.equal(api.loginError(doc), false);
});
const guest = "https://radius-01.tu-berlin.de:8443/portal/PortalSetup.action";
test("matches the inspected TU guest login form", async () => {
  const p = await page("guest-login.html", guest);
  assert.equal(p.plan().kind, "guest-password");
  assert.equal(p.plan().username.name, "user.username");
  assert.equal(p.plan().password.name, "user.password");
  p.doc.forms[0].querySelector('[name="portal"]').value = "another-portal";
  assert.equal(p.plan(), null);
});
test("guest login requires the exact TLS origin, POST action and known portal", async () => {
  for (const url of [guest.replace(":8443", ""), guest.replace("https:", "http:"), guest.replace(".de:", ".de.attacker.test:")]) {
    assert.equal((await page("guest-login.html", url)).plan(), null);
  }
  for (const mutate of [
    doc => doc.forms[0].action = "https://attacker.test/portal/LoginSubmit.action",
    doc => doc.forms[0].method = "get",
    doc => doc.forms[0].action = "ChangePasswordSubmit.action",
    doc => doc.querySelector('#ui_login_signon_button').setAttribute("formaction", "https://attacker.test/")
  ]) {
    const p = await page("guest-login.html", guest); mutate(p.doc); assert.equal(p.plan(), null);
  }
});
test("guest AGB adapter selects Accept and supports scroll-gated controls", async () => {
  const p = await page("guest-terms.html", guest);
  assert.equal(p.plan().kind, "guest-terms");
  assert.equal(p.plan().button.id, "ui_aup_accept_button");
  p.doc.querySelector('#ui_aup_accept_button').disabled = true;
  assert.equal(p.plan().needsScroll, true);
  p.doc.forms[0].action = "ChangePasswordSubmit.action";
  assert.equal(p.plan(), null);
});
