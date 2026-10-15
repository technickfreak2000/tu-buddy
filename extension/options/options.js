import {DEFAULT_SETTINGS} from "../lib/policy.js";
import {parseTotp, generateTotp} from "../lib/totp.js";

const $ = id => document.getElementById(id);
let previewTimer;
function status(message, error = false) {
  $("status").textContent = message;
  $("status").dataset.error = String(error);
}
async function load() {
  const config = {...DEFAULT_SETTINGS, ...(await browser.storage.local.get("settings")).settings};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (typeof config[key] === "boolean") $(key).checked = config[key];
    else $(key).value = config[key];
  }
}
$("settings").addEventListener("submit", async event => {
  event.preventDefault();
  $("save").disabled = true;
  try {
    const config = Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([key, value]) =>
      [key, typeof value === "boolean" ? $(key).checked : $(key).value]));
    if (config.totp.trim()) parseTotp(config.totp);
    if (Boolean(config.username.trim()) !== Boolean(config.password)) throw new Error("Enter both a username and password, or leave both empty.");
    const result = await browser.runtime.sendMessage({type: "save", settings: config});
    if (!result?.ok) throw new Error(result?.reason || "Could not save settings.");
    status("Saved. Reload any open TU tabs to start with the new settings.");
  } catch (error) { status(error.message, true); }
  finally { $("save").disabled = false; }
});
$("forget").addEventListener("click", async () => {
  try {
    const result = await browser.runtime.sendMessage({type: "forget"});
    if (!result?.ok) throw new Error("Could not delete settings.");
    clearTimeout(previewTimer); $("totp-preview").textContent = "";
    await load();
    status("Deleted saved settings and credentials. Automatic login is paused.");
  } catch (error) { status(error.message, true); }
});
$("test-totp").addEventListener("click", async () => {
  clearTimeout(previewTimer);
  try {
    const token = await generateTotp(parseTotp($("totp").value));
    $("totp-preview").textContent = `${token.code} · ${Math.ceil(token.remaining)}s left`;
    previewTimer = setTimeout(() => { $("totp-preview").textContent = ""; }, token.remaining * 1000);
    status("Compare with your authenticator. Your computer clock must be accurate.");
  } catch (error) { $("totp-preview").textContent = ""; status(error.message, true); }
});
document.querySelectorAll("[data-reveal]").forEach(button => button.addEventListener("click", () => {
  const input = $(button.dataset.reveal);
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  button.textContent = show ? "Hide" : "Show";
  button.setAttribute("aria-pressed", String(show));
  button.setAttribute("aria-label", `${show ? "Hide" : "Show"} ${input.id === "totp" ? "TOTP secret" : "password"}`);
}));
load().catch(() => status("Could not load extension settings.", true));
