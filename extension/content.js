(() => {
  if (window.top !== window) return;
  const {plan, loginError, isLogout, authenticated} = globalThis.TuLoginAdapters;
  let working = false, stopped = false, timer, retryTimer, notice, retryAt = 0;
  let attempted = new WeakSet();
  let reportedSuccess = false;
  let setupPending = false;
  const preparedTerms = new WeakSet();
  const send = message => browser.runtime.sendMessage(message);

  function show(message) {
    if (!notice) {
      notice = document.createElement("aside");
      notice.setAttribute("role", "status");
      Object.assign(notice.style, {position: "fixed", bottom: "18px", right: "18px", zIndex: "2147483647",
        maxWidth: "360px", padding: "14px 18px", background: "#fff", color: "#242424", border: "1px solid #bc2634",
        borderRadius: "10px", boxShadow: "0 4px 20px #0002", font: "14px/1.5 system-ui"});
      document.documentElement.append(notice);
    }
    const text = `TU Auto Login: ${message}`;
    if (notice.textContent !== text) notice.textContent = text;
  }
  function fill(input, value) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", {bubbles: true}));
    input.dispatchEvent(new Event("change", {bubbles: true}));
  }
  async function run() {
    if (working || stopped || setupPending || document.hidden) return;
    if (Date.now() < retryAt) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(run, retryAt - Date.now() + 25);
      return;
    }
    working = true;
    try {
      const status = await send({type: "check"});
      if (!status?.active) return;
      if (!reportedSuccess && authenticated(document, location.href)) {
        reportedSuccess = true;
        await send({type: "success"});
      }
      const current = plan(document, location.href);
      if (!current || attempted.has(current.form || current.button)) return;
      if (status.needsSetup && ["password", "otp", "guest-password"].includes(current.kind)) {
        const setup = await send({type: "open-setup", step: current.kind, action: current.action});
        if (setup?.opened) { setupPending = true; return; }
        if (!setup?.alreadyConfigured && !setup?.skipped) {
          show("Open the extension settings to set up automatic login.");
          return;
        }
      }
      if (current.kind === "guest-terms" || current.terms) {
        if (!status.acceptGuestTerms) {
          show("Accept the guest network AGB here, or enable automatic acceptance in settings.");
          return;
        }
        if (current.terms && !current.terms.checked) current.terms.click();
        if (current.needsScroll) {
          if (!preparedTerms.has(current.form) && current.scrollArea) {
            preparedTerms.add(current.form);
            current.scrollArea.scrollTop = current.scrollArea.scrollHeight;
            current.scrollArea.dispatchEvent(new Event("scroll", {bubbles: true}));
            setTimeout(schedule, 300);
          }
          return;
        }
      }
      if (loginError(document)) {
        await send({type: "failure"});
        stopped = true;
        show("Login stopped after an error. Check the page, then click Resume in the toolbar.");
        return;
      }
      const result = await send({type: current.kind, action: current.action});
      if (!result?.ok) {
        if (result?.retryMs) {
          clearTimeout(retryTimer);
          retryAt = Date.now() + result.retryMs;
          retryTimer = setTimeout(run, result.retryMs);
          show("Waiting for a fresh OTP…");
        } else if (result?.reason && current.kind !== "start") show(result.reason);
        return;
      }
      // Re-check DOM and pause state after awaiting the background page.
      if (stopped || !current.button.isConnected || !(await send({type: "check"}))?.active) return;
      const latest = plan(document, location.href);
      if (!latest || latest.button !== current.button || latest.kind !== current.kind || latest.action !== current.action) return;
      attempted.add(current.form || current.button);
      if (["password", "guest-password"].includes(current.kind)) {
        fill(current.username, result.username);
        fill(current.password, result.password);
      } else if (current.kind === "otp") fill(current.otp, result.code);
      // A real click preserves Shibboleth's named submitter and Moses's Vue handler.
      current.button.click();
    } catch {
      stopped = true;
      show("Automatic login stopped. Reload this tab after checking the extension settings.");
    } finally { working = false; }
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, 250);
  }
  document.addEventListener("click", event => {
    if (!event.isTrusted || !isLogout(event.target, location.href)) return;
    // Delay navigation just long enough to persist the logout pause.
    const control = event.target.closest('a, button, input[type="submit"]');
    stopped = true;
    event.preventDefault();
    event.stopImmediatePropagation();
    send({type: "pause", reason: "logout"}).catch(() => {}).finally(() => control.click());
  }, true);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) schedule(); });
  browser.runtime.onMessage.addListener(message => {
    if (message?.type === "login-setup-finished") { setupPending = false; schedule(); }
  });
  document.addEventListener("input", event => {
    // Let a person take over a login form without overwriting what they type.
    if (event.isTrusted && ["shibboleth.tubit.tu-berlin.de", "radius-01.tu-berlin.de"].includes(location.hostname)) stopped = true;
  }, true);
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && changes.loginSetupBypass) { setupPending = false; schedule(); }
    if ((area === "local" && changes.settings) || (area === "session" && changes.runtime)) {
      const oldState = changes.runtime?.oldValue, newState = changes.runtime?.newValue;
      if (changes.settings || (oldState?.paused && !newState?.paused)) {
        stopped = false;
        setupPending = false;
        attempted = new WeakSet();
        retryAt = 0;
        notice?.remove(); notice = null;
      }
      schedule();
    }
  });
  new MutationObserver(schedule).observe(document.documentElement, {subtree: true, childList: true,
    attributes: true, attributeFilter: ["class", "hidden", "disabled", "action"]});
  schedule();
})();
