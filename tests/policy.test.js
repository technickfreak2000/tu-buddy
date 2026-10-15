import {test} from "node:test";
import assert from "node:assert/strict";
import {classifyUrl, safeFormAction, trustedSender, freshState, reserveAttempt, WINDOW_MS} from "../extension/lib/policy.js";

const idp = "https://shibboleth.tubit.tu-berlin.de/idp/profile/SAML2/Redirect/SSO?execution=e1s2";
test("exact HTTPS origins and SSO paths only", () => {
  assert.equal(classifyUrl(idp), "idp");
  assert.equal(classifyUrl("https://isis.tu-berlin.de/login/index.php"), "isis");
  assert.equal(classifyUrl("https://moseskonto.tu-berlin.de/moses/index.html"), "moses");
  for (const bad of ["http://shibboleth.tubit.tu-berlin.de/idp/profile/SAML2/Redirect/SSO", "https://shibboleth.tubit.tu-berlin.de.attacker.test/idp/profile/SAML2/Redirect/SSO", "https://shibboleth.tubit.tu-berlin.de/pwr-reset.html", "https://user:pass@shibboleth.tubit.tu-berlin.de/idp/profile/SAML2/Redirect/SSO", "https://shibboleth.tubit.tu-berlin.de:8443/idp/profile/SAML2/Redirect/SSO", "https://other.tu-berlin.de/", "not a url"]) assert.equal(classifyUrl(bad), null, bad);
});
test("credentials require a top-level trusted tab and trusted form action", () => {
  assert.equal(trustedSender({url: idp, tab: {id: 1}, frameId: 0}), true);
  assert.equal(trustedSender({url: idp, tab: {id: 1}, frameId: 1}), false);
  assert.equal(trustedSender({url: idp, frameId: 0}), false);
  assert.equal(safeFormAction("?execution=e1s3", idp), true);
  for (const action of ["https://attacker.test/", "//shibboleth.tubit.tu-berlin.de.attacker.test/", "/pwr-reset.html", "javascript:alert(1)", `${idp}#bad`]) assert.equal(safeFormAction(action, idp), false);
});
test("duplicate steps and repeated failures stop; success settles duplicates without resetting rate limits", () => {
  const state = freshState({}, 0);
  const attempt = {kind: "password", flow: "e1s2", tabId: 1};
  assert.equal(reserveAttempt(state, attempt, 10), "");
  assert.match(reserveAttempt(state, attempt, 11), /already attempted/);
  state.attempts[0].settled = true;
  assert.equal(reserveAttempt(state, attempt, 12), "");
  assert.equal(reserveAttempt(state, {...attempt, flow: "e2s2"}, 13), "");
  assert.match(reserveAttempt(state, {...attempt, tabId: 2}, 14), /repeated attempts/);
  assert.equal(freshState(state, WINDOW_MS + 20).attempts.length, 0);
});
