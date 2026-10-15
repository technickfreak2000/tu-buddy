# TU Berlin Auto Login for Firefox

Automatically signs in through the normal TU login flows for **ISIS**, **Moses**, **TUport** and **TUB-Guest Wi-Fi**. When TU's shared Shibboleth login requires authentication, it can submit a locally saved TUB username, password and fresh TOTP code. TUport redirects directly from its SAP site to that shared login; the extension completes the account and subsequent TOTP steps there using the same saved account. TUB-Guest can use the same account and automatically accept its AGB / acceptable-use policy.

TU controls session expiration. This extension **signs you back in while browsing** rather than making sessions permanent. It does not keep website sessions alive, rewrite cookies or change server security settings. Background tabs wait until you open them. No account is required to build the extension.

## Try it in Firefox

Requires desktop **Firefox 142 or newer**.

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on…** and select [`extension/manifest.json`](extension/manifest.json).
3. The settings tab opens. Enable the services you want.
4. For unattended login, enter your **TUB username and password**, and optionally your **TOTP setup secret**. Review the TUB-Guest and automatic AGB settings, then click **Save settings**.
5. Visit [ISIS](https://isis.tu-berlin.de/), [Moses](https://moseskonto.tu-berlin.de/moses/index.html) or [TUport](https://tuport.sap.tu-berlin.de/). Existing TU tabs may need a reload. Pin the extension to your toolbar to access Pause, Resume and Settings.

When an ISIS/Moses login control or supported TU sign-in form appears and no username/password is saved, TU Buddy opens its own **Set up automatic TU login** page. Enter your username, password and optional **TOTP setup secret** (Base32 or an `otpauth://totp/...` URI). **Save & continue** stores the account locally, brings the original TU tab back and continues its login. The original form stays open with its cookies and hidden fields while you configure the account. No secret is placed in a page URL or entered into TU's webpage; only generated codes are used there.

**Use TU login without saving**, or closing the setup tab, returns you to manual login and suppresses setup prompts for that original tab until it closes or Firefox restarts. Other tabs can still offer setup. Existing SSO sessions can be reused without saving an account. Pausing the extension stops setup prompts too. The dedicated setup page clearly identifies itself as part of this independent extension; it is not an official TU page.

**Temporary add-ons are removed when Firefox closes.** For use across browser restarts, build the ZIP and submit it to Mozilla's [Developer Hub](https://addons.mozilla.org/developers/) as an **unlisted / self-distributed** extension. Install the signed XPI Mozilla provides using `about:addons` → gear → **Install Add-on From File…**. Regular Firefox requires Mozilla signing; the ZIP in `dist/` is a submission package, not an installable signed release. See [Mozilla's signing and distribution guide](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

## ISIS lecture video downloads

On ISIS VideoService viewer pages, TU Buddy adds a **Download** button beside the player settings when ISIS has no native video download control. It uses the direct video file already exposed by the player, with the lecture title as the suggested filename. It updates when the viewer switches videos; multiple players get distinct filenames. Existing native download controls are kept.

Downloads start only when you click. The button calls Firefox's downloads API and keeps the viewer open, even when the site would otherwise open media links in another tab. The suggested filename follows the lecture title, and the download uses the viewer's ISIS session, including Firefox containers and private windows. The helper works for direct MP4, M4V, WebM, OGV and MOV files served by ISIS VideoService or Moodle's file endpoint. It does not assemble HLS/DASH streams or handle DRM. The `downloads` permission starts actual file downloads. The `cookies` permission is used to select the viewer tab's cookie store for container sessions; cookie values are not read or modified. Video URLs are not stored by the extension. This viewer feature remains available when automatic login is paused.

## TUB-Guest and a second Wi-Fi adapter

The extension recognizes TU's Cisco portal at **`https://radius-01.tu-berlin.de:8443/portal/`**, portal ID `26d19560-2e58-11e9-98fb-0050568775a3`. The login form is restricted to that origin and portal ID. The saved TUB credentials are used only in its verified `LoginSubmit.action` form. The separate, recognized AUP form is restricted to that HTTPS origin and checked acceptance endpoints; a supplied portal ID must match. Automatic acceptance sets Cisco's `aupAccepted` field to `true` and submits the original form with its hidden fields, including when its Accept button is disabled by the scroll requirement. Turn **Automatically accept TUB-Guest's AGB** off if you prefer to accept each time. This setting does not accept general Shibboleth data-release consent, contracts or unrelated website terms.

After successful guest login, TU Buddy closes the tab when the exact HTTPS portal's `AupSubmit.action` page has the title **Success**. This works even if Cisco's spinner never stops, including for background tabs. Login and policy pages stay open until that success indication appears. The same check runs after an extension update or browser startup for tabs already showing Success. Disabling guest automation or pausing the extension also disables automatic closing.

With one default network route, Firefox's captive-portal API detects a locked network and the extension opens its normal detection page. No credentials are placed on the HTTP detection page. Autofill starts only after reaching TU's exact HTTPS portal, with normal certificate verification. Use **Find TUB-Guest login** in the toolbar to check manually.

**For a second adapter (e.g. wlan3 while wlan0 still provides internet), install the optional Linux helper:**

```sh
python3 native/install.py
```

Restart Firefox and leave **Detect TUB-Guest on a second Wi-Fi adapter** enabled. The helper requires Python 3, NetworkManager's `nmcli` and `curl`. It reads the active Wi-Fi SSID, identifies profiles by their UUID (duplicate profile names are supported), and binds a credential-free HTTP probe to the actual **TUB-Guest** adapter. It passes only the fresh, verified TU portal URL to Firefox. Adapter names can change from `wlan2` to `wlan3` without configuration. A reconnect is detected at startup or within approximately one minute while Firefox is running. Already checked connections are not probed repeatedly; the toolbar button explicitly retries. Opening a portal tab does not by itself prove that network login succeeded.

The helper never receives passwords or OTPs, changes routes, switches networks, installs a service or keeps its own background process running. Portal-session URLs are not written to persistent extension storage or logs. Browser login still needs a route to the HTTPS portal; in the inspected dual-adapter setup it was reachable through the normal route. Firefox's own network detection can miss a secondary adapter, which is why this helper is needed.

The installer registers only this extension's stable ID and copies the helper under `~/.local/share/tu-buddy/`, with its Firefox manifest at `~/.mozilla/native-messaging-hosts/de.tu_berlin.tu_buddy.json`. No root privileges are required. This path targets regular Linux Firefox; sandboxed Snap/Flatpak builds may require their own native-messaging integration. Remove it with `python3 native/install.py --uninstall`. For inspection or packaging, `--prefix /tmp/test-home` installs into an alternate home directory.

Do not bookmark or hardcode a captured `sessionId`/`token` URL: it belongs to a particular Wi-Fi session. The helper discovers a fresh redirect after reconnection. The nonsecret portal ID is the only portal identifier included in source.

## TOTP setup

Use the Base32 secret used to set up your authenticator, or the full `otpauth://totp/...` URI encoded in the setup QR code. A six-digit OTP expires and is **not** a setup secret. Do not put a real secret into an online QR decoder or this repository. If your authenticator supports exporting an existing entry, you can obtain the secret from that export locally.

The default is HMAC-SHA1, six digits, 30 seconds. An `otpauth` URI can specify SHA256/SHA512, eight digits and a different period. **Preview current OTP** lets you compare with your authenticator without contacting TU. Your computer clock must be correct. The extension waits for a new code when fewer than four seconds remain and never submits the same time step twice in a browser session.

TU explains its procedure and where the setup QR originates in its [TOTP instructions](https://www.tu.berlin/campusmanagement/it-support/zwei-faktor-authentifizierung-tan-verwaltung-totp-token). TAN lists, hardware tokens, push confirmation and CAPTCHA remain manual. Unknown login forms and general consent screens are left for you to complete; TUB-Guest's AGB is handled by its separate setting.

## Controls and failures

- **Pause / Resume:** the toolbar popup controls all automatic login. Pauses persist across restarts.
- **Log out:** clicking a recognized logout control pauses automatic login globally until Resume. This keeps the extension from immediately signing you back in.
- **Errors:** a missing account opens the extension setup page, including from ISIS and Moses; error text alone does not disable automation. An error after an automatic password/OTP submission pauses retries and opens the same page to correct saved details. Saving resumes the original login; skipping leaves automation paused. An existing error from the previous response is ignored when retrying corrected details. The extension also blocks repeated attempts to the same step and limits password and OTP submissions to three each per ten minutes across tabs. Resume clears attempt limits explicitly; it does not permit reusing the same OTP.
- **Service switches:** ISIS, Moses and TUport have separate switches. A service name is remembered per tab for redirects to Shibboleth, so turning a service off also stops its recognized account and TOTP flow. Visiting the central login without a known originating service follows the main switch. The main enable switch and toolbar Pause also stop automation on the central SSO page.
- **Delete saved settings & credentials:** clears the account details and pauses automation. It does not log out an already authenticated TU session.

## Credential handling and permissions

Unattended login after restarting Firefox requires recoverable credentials. **The password and TOTP seed are stored unencrypted in this extension's `browser.storage.local` in your Firefox profile.** They are not protected by Firefox's Primary Password. Saving both factors in one profile reduces their separation: someone who can read or use the profile can use both. Use only a private, trusted profile; full-disk encryption protects it when your device is off. You can choose SSO-only mode instead.

- No analytics, remote code, third-party requests, telemetry, external backend or `storage.sync`.
- Credentials are filled only in recognized POST login forms on **`https://shibboleth.tubit.tu-berlin.de/idp/profile/...`** and the pinned **`https://radius-01.tu-berlin.de:8443/portal/LoginSubmit.action`**, with checked form and submit-button destinations. The TOTP seed stays in the background context; only a generated code reaches a Shibboleth page.
- Content scripts run in the top frame on the exact ISIS, Moses, TUport, Shibboleth and radius-01 hosts. The video-download helper runs only on ISIS VideoService pages. No wildcard access to other TU subdomains, browsing history access or web request interception. Cookie permission is used only for the download session context.
- `webNavigation` observes top-level navigation starts so TUport's immediate server redirect retains its service setting; only a service name per tab is stored, with no navigation URLs or history retained. `captivePortal` checks Firefox's network-login state, `alarms` schedules guest-network checks, and `nativeMessaging` communicates with the optional read-only Linux helper. The helper can only perform fixed portal discovery, never arbitrary commands or login submissions.
- Settings and credential-management messages require an exact extension-owned settings, setup or popup URL. Websites cannot invoke them. Setup return requests are bound to their original and setup tab IDs; they cannot supply an arbitrary return URL. Setup pages cannot be embedded in website frames.
- Attempt metadata is kept in `storage.session`; credentials, preferences and pause reason are kept locally. No credentials are written to logs or shipped in the package.
- The manifest declares `authenticationInfo` because optional saved credentials are submitted to TU's login service. This extension has no developer-operated data collection service. See [PRIVACY.md](PRIVACY.md).

## Develop and package

Requires Node.js 22+ (Node 26 used for validation) and the `zip` command.

```sh
npm ci
npm test
npm run lint
npm run build
npm start
```

`npm start` launches an isolated temporary Firefox profile; change the Firefox binary argument in `package.json` if it is installed elsewhere. The build writes `dist/tu-berlin-auto-login-1.4.1.zip` and includes only `extension/`. Install the optional native helper separately from the repository. Runtime JavaScript has no dependencies, no bundler and no network-loaded libraries.

Tests cover RFC 6238 TOTP vectors, URI validation, exact-origin and message authorization, retry limits, pause persistence, login-button selection, named submitters, dynamic Moses navigation, OTP waits, destination changes, guest credential/AGB handling, portal discovery, native message framing, changing adapter names and helper installation/removal. Native tests use Python's standard library.

## TUport

Enable **TUport** in settings and visit [tuport.sap.tu-berlin.de](https://tuport.sap.tu-berlin.de/). Its server redirects to TU Shibboleth: the saved username/password are entered first, followed by a fresh code generated from the saved TOTP setup secret. Without an account, the extension setup page opens on the Shibboleth form; without a TOTP secret, the OTP stays manual. No credentials or setup secret are filled into the SAP site itself. Returning to TUport finishes the attempt for duplicate prevention while retaining the rate limits.

### Verification limits

The ISIS video fixture is reduced from the viewer markup supplied by the user. Firefox checks downloaded tiny local test files through the downloads API in both normal and container sessions, with the expected lecture filenames and session cookies. The viewer stayed open and no media tab appeared, including on a fixture that intercepts link clicks to open new tabs. Native download detection and Vue rerenders are covered by DOM tests; no lecture media was downloaded from TU during verification.

TUport's public redirect and account form were inspected on **2026-10-15** and use the same Shibboleth form as ISIS. The public ISIS login form, its redirect to Shibboleth, the TU username/password form and Moses's current JavaScript login control were inspected on **2026-10-15**. TUB-Guest's actual login form and Cisco JavaScript were also inspected through `wlan3`; a live device-specific portal redirect was obtained. Reduced fixtures preserve relevant controls without session tokens. **No real TUB credentials have been used.** TU's app-code prompt and the `j_totp` input / named Continue button were supplied from the user's live page on **2026-10-15** and are covered by a reduced fixture. Full authenticated OTP and AGB documents have not been inspected; those fixtures use representative forms, with guest AGB control names verified in the portal's JavaScript. If TU changes markup, the adapter may need updating. Other TU services work only when their flow reaches the supported Shibboleth form. TU outages, expired SAML flows and mandatory interaction can still interrupt login.

Fresh Firefox profiles were used to verify that the public ISIS and TUport login flows open the extension's setup page and that skipping restores the original login tab. TUport's disabled switch was also checked across its server redirect. Local account saving, OTP preview and clearing sensitive fields were also verified in Firefox, using a test account after closing all TU login tabs. A representative guest AUP form was also tested in Firefox with its Accept button disabled: acceptance was submitted and the hidden token was preserved. A local streaming fixture also verified that a background Success tab closes before DOMContentLoaded or load, while login and policy tabs remain open. A local Firefox test also completed password then `j_totp` submission at the same SSO execution URL, checking the generated code, hidden fields and named Continue submitter. These checks use fixtures for authenticated forms and send no test credentials to TU.

The extension deliberately does not automatically retry a “Stale Request” page or guess new identity-provider domains. Start again from the service's home page, check the toolbar state and Resume if needed.
