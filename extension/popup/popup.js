const $ = id => document.getElementById(id);
let paused;
async function refresh() {
  const status = await browser.runtime.sendMessage({type: "status"});
  if (!status) throw new Error("Could not read extension state.");
  paused = !status.enabled || Boolean(status.paused);
  $("state").textContent = paused ? "PAUSED" : "ACTIVE";
  $("detail").textContent = status.paused || (status.enabled ? "Automatically sign in while browsing TU services." : "Automatic login is disabled in settings.");
  $("credentials").textContent = status.hasPassword ? `Password saved · ${status.hasTotp ? "TOTP enabled" : "OTP entry is manual"}` : "SSO only · No saved password";
  $("toggle").textContent = paused ? "Resume automatic login" : "Pause automatic login";
  $("toggle").disabled = false;
}
$("toggle").addEventListener("click", async () => {
  $("toggle").disabled = true;
  try {
    await browser.runtime.sendMessage({type: paused ? "resume" : "pause"});
    await refresh();
  } catch { $("detail").textContent = "Could not update state. Reopen this popup to try again."; }
});
$("settings").addEventListener("click", () => browser.runtime.openOptionsPage());
refresh().catch(error => { $("detail").textContent = error.message; });
