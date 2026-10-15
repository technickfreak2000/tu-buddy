/* Shared with fixture tests. Runs in Firefox's isolated content-script world. */
(() => {
  const IDP = "https://shibboleth.tubit.tu-berlin.de";
  const GUEST = "https://radius-01.tu-berlin.de:8443";
  const PORTAL = "26d19560-2e58-11e9-98fb-0050568775a3";
  const isVisible = element => Boolean(element && !element.disabled && element.getClientRects().length &&
    getComputedStyle(element).visibility !== "hidden" && getComputedStyle(element).display !== "none");
  const firstVisible = (root, selector) => [...root.querySelectorAll(selector)].find(isVisible);
  const idpUrl = url => url.origin === IDP && /^\/idp\/profile\/(?:SAML2|Shibboleth|cas|oidc)\//i.test(url.pathname);
  const actionFor = (form, button, href) => new URL(button.getAttribute("formaction") || form.getAttribute("action") || href, form.baseURI || href);

  function authenticated(doc, href) {
    const url = new URL(href);
    if (url.origin === "https://isis.tu-berlin.de") return Boolean(doc.querySelector('a[href*="/login/logout.php"], body.loggedin'));
    if (url.origin === "https://moseskonto.tu-berlin.de") return Boolean(doc.querySelector('.nav-top-user-logout, a[href*="/internal/user/logout"]'));
    if (url.origin === GUEST) return Boolean(doc.querySelector('#page-success, #ui_success_content_label'));
    return false;
  }

  function plan(doc, href) {
    const url = new URL(href);
    if (url.origin === GUEST && url.pathname.startsWith("/portal/")) {
      if (authenticated(doc, href)) return null;
      for (const form of doc.forms) {
        const portal = form.querySelector('input[name="portal"]');
        if (portal && portal.value !== PORTAL) continue;
        const login = firstVisible(form, '#ui_login_signon_button');
        // The AUP button can start disabled until its scroll/checkbox requirement is met.
        const accept = form.querySelector('#ui_aup_accept_button');
        const button = login || accept;
        if (!button || !button.getClientRects().length) continue;
        const action = actionFor(form, button, href);
        if (action.origin !== GUEST || action.username || action.password || action.hash ||
            (button.getAttribute("formmethod") || form.method).toLowerCase() !== "post" ||
            (button.getAttribute("formtarget") || form.target || "_self") !== "_self") continue;
        const terms = form.querySelector('input[type="checkbox"][id="aupAccepted"]');
        if (login && portal?.value === PORTAL && form.id === "portalloginForm" && action.pathname === "/portal/LoginSubmit.action") {
          const username = firstVisible(form, 'input[name="user.username"]');
          const password = firstVisible(form, 'input[name="user.password"][type="password"]');
          if (username && password) return {kind: "guest-password", form, button, username, password, terms, action: action.href};
        }
        const acceptance = form.querySelector('input[type="hidden"][id="aupAccepted"][name="aupAccepted"]');
        if (accept && acceptance?.form === form && doc.querySelector('#page-aup')?.contains(form) && form.name === "aupForm" &&
            form.action === action.href && form.method.toLowerCase() === "post" && (form.target || "_self") === "_self" &&
            ["/portal/AupSubmit.action", "/portal/AupAccept.action", "/portal/Aup.action"].includes(action.pathname)) {
          return {kind: "guest-terms", form, button, terms, acceptance, scrollArea: doc.querySelector('.cisco-ise-aup-text'),
            needsScroll: button.disabled || Boolean(button.closest('.ui-disabled')), action: action.href};
        }
      }
      return null;
    }
    if (url.origin === "https://isis.tu-berlin.de") {
      if (authenticated(doc, href)) return null;
      const button = firstVisible(doc, '#shibboleth_login #shibbolethbutton');
      if (button?.form && actionFor(button.form, button, href).origin === url.origin &&
          actionFor(button.form, button, href).pathname === "/auth/shibboleth/index.php") {
        return {kind: "start", button, form: button.form};
      }
      // The navbar login link preserves Moodle's wanted URL through its normal login flow.
      const link = [...doc.querySelectorAll('.logininfo a[href], .usermenu a[href]')].find(a => {
        const target = new URL(a.href, href);
        return isVisible(a) && target.origin === url.origin && target.pathname === "/login/index.php";
      });
      return link ? {kind: "start", button: link} : null;
    }
    if (url.origin === "https://moseskonto.tu-berlin.de" && url.pathname.startsWith("/moses/")) {
      if (authenticated(doc, href)) return null;
      const button = firstVisible(doc, '.nav-top-user-login');
      return button ? {kind: "start", button} : null;
    }
    if (!idpUrl(url)) return null;
    for (const form of doc.forms) {
      const button = firstVisible(form, 'button[name="_eventId_proceed"], input[type="submit"][name="_eventId_proceed"], #login-button');
      if (!button) continue;
      const action = actionFor(form, button, href);
      const method = button.getAttribute("formmethod") || form.method;
      if (!idpUrl(action) || action.username || action.password || action.hash || method.toLowerCase() !== "post" ||
          (button.getAttribute("formtarget") || form.target || "_self") !== "_self") continue;
      const username = firstVisible(form, 'input[name="j_username"]');
      const password = firstVisible(form, 'input[name="j_password"][type="password"]');
      if (username && password) return {kind: "password", form, button, username, password, action: action.href};
      // Never guess a TAN-list challenge or submit password-change / consent / enrollment forms.
      const otp = firstVisible(form, 'input[autocomplete="one-time-code"], input[name="j_tokenNumber"], input[name="j_token"], input[name="j_otp"], input[name="otp"], input[name="totp"]');
      if (otp && !password && !form.querySelector('input[name="SAMLResponse"], input[name="newPassword"]')) {
        const text = form.textContent || "";
        const tokenField = ["j_tokenNumber", "j_token"].includes(otp.name);
        if ((!tokenField || /TOTP|authenticator|authentifizierungs|token|einmalpasswort|one.time.password/i.test(text)) &&
            !/TAN[\s-]*(?:list|liste)|TAN\s*(?:number|nummer)|TAN\s*(?:Nr\.?|#)\s*\d/i.test(text)) {
          return {kind: "otp", form, button, otp, action: action.href};
        }
      }
    }
    return null;
  }

  function loginErrors(doc) {
    const candidates = doc.querySelectorAll('.form-error, .login-error, #login-error, .alert-danger, [role="alert"], .error, .cisco-ise-error-message, .cisco-ise-error, #ui_login_error_message');
    return [...candidates].filter(el => isVisible(el) &&
      /invalid|incorrect|failed|failure|ungültig|falsch|fehlgeschlagen|gesperrt|locked|abgelaufen|expired|nicht korrekt/i.test(el.textContent));
  }
  const loginError = doc => loginErrors(doc).length > 0;
  function isLogout(element, href) {
    const control = element?.closest?.('a, button, input[type="submit"]');
    if (!control) return false;
    const target = control.getAttribute("href");
    if (target) {
      try {
        const url = new URL(target, href);
        if (["https://isis.tu-berlin.de", "https://moseskonto.tu-berlin.de", "https://tuport.sap.tu-berlin.de", IDP, GUEST].includes(url.origin) &&
            /(?:\/logout(?:\.|\/|$)|\/Logout(?:\?|$)|\/profile\/Logout)/i.test(url.pathname)) return true;
      } catch { /* Also check explicit logout UI below. */ }
    }
    return control.matches('.nav-top-user-logout, [name="_eventId_logout"]') ||
      /^(?:logout|log out|sign out|abmelden)$/i.test((control.textContent || control.value || "").trim());
  }
  globalThis.TuLoginAdapters = Object.freeze({plan, loginError, loginErrors, isLogout, authenticated});
})();
