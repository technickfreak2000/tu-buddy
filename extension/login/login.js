import {parseTotp, generateTotp} from "../lib/totp.js";

const $ = id => document.getElementById(id);
let previewTimer;
function status(message, error = false) {
  $("status").textContent = message;
  $("status").dataset.error = String(error);
}
function busy(value) {
  $("save").disabled = value;
  $("skip").disabled = value;
}
function clearSecrets() {
  $("password").value = "";
  $("totp").value = "";
  $("code").textContent = "";
  clearTimeout(previewTimer);
}
async function finish(result, skipped = false) {
  clearSecrets();
  if (result.returned) {
    const tab = await browser.tabs.getCurrent();
    if (tab?.id !== undefined) await browser.tabs.remove(tab.id);
  } else if (skipped) {
    location.replace(browser.runtime.getURL("options/options.html"));
  } else {
    $("login-setup").hidden = true;
    $("done").hidden = false;
    status("Saved. Your next TU login will use this account.");
  }
}
$("login-setup").addEventListener("submit", async event => {
  event.preventDefault();
  busy(true);
  try {
    const account = {username: $("username").value.trim(), password: $("password").value, totp: $("totp").value.trim()};
    if (!account.username || !account.password) throw new Error("Enter your TUB username and password.");
    if (account.totp) parseTotp(account.totp);
    const result = await browser.runtime.sendMessage({type: "setup-save", account});
    if (!result?.ok) throw new Error(result?.reason || "Could not save your account. Please try again.");
    await finish(result);
  } catch (error) { status(error.message, true); }
  finally { busy(false); }
});
$("skip").addEventListener("click", async () => {
  busy(true);
  try {
    const result = await browser.runtime.sendMessage({type: "setup-skip"});
    if (!result?.ok) throw new Error("Could not return to TU login. You can close this tab and use your original login tab.");
    await finish(result, true);
  } catch (error) { status(error.message, true); }
  finally { busy(false); }
});
$("preview").addEventListener("click", async () => {
  clearTimeout(previewTimer);
  try {
    const token = await generateTotp(parseTotp($("totp").value));
    $("code").textContent = `${token.code} · ${Math.ceil(token.remaining)}s left`;
    previewTimer = setTimeout(() => { $("code").textContent = ""; }, token.remaining * 1000);
    status("Compare this code with your authenticator before saving.");
  } catch (error) { $("code").textContent = ""; status(error.message, true); }
});
$("totp").addEventListener("input", () => { clearTimeout(previewTimer); $("code").textContent = ""; });
document.querySelectorAll("[data-reveal]").forEach(button => button.addEventListener("click", () => {
  const input = $(button.dataset.reveal);
  const reveal = input.type === "password";
  input.type = reveal ? "text" : "password";
  button.textContent = reveal ? "Hide" : "Show";
  button.setAttribute("aria-pressed", String(reveal));
  button.setAttribute("aria-label", `${reveal ? "Hide" : "Show"} ${input.id === "totp" ? "TOTP secret" : "password"}`);
}));
async function load() {
  const info = await browser.runtime.sendMessage({type: "setup-info"});
  if (!info) throw new Error("Could not load the login setup. Open extension settings to configure your account.");
  $("username").value = info.username || "";
  if (info.canReturn) {
    const label = {idp: "TU single sign-on", guest: "TUB-Guest Wi-Fi"}[info.service] || "TU login";
    $("destination").textContent = `Continue to ${label} after saving`;
    $("destination").hidden = false;
  }
  if (info.hasTotp) {
    $("totp-help").textContent = "A TOTP setup secret is already saved. Leave this field empty to keep it, or enter a new Base32 secret or otpauth://totp/ URI. A six-digit code cannot generate future codes.";
  }
}
load().catch(error => status(error.message, true));
