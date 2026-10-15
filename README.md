# TU Berlin Auto Login for Firefox

Automatically clicks the normal TU sign-in controls on **ISIS** and **Moses**. When TU's shared Shibboleth login requires authentication, it can submit a locally saved TUB username, password and fresh TOTP code. Other services such as tuPORT can benefit when they redirect to the same Shibboleth host; their own login buttons are not automated.

TU controls session expiration. This extension **signs you back in while browsing** rather than making sessions permanent. It does not poll services, keep idle tabs alive, rewrite cookies or change server security settings. Background tabs wait until you open them. No account is required to build the extension.

## Try it in Firefox

Requires desktop **Firefox 142 or newer**.

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on…** and select [`extension/manifest.json`](extension/manifest.json).
3. The settings tab opens. Enable the services you want.
4. For unattended login, enter your **TUB username and password**, and optionally your **TOTP setup secret**. Click **Save settings**.
5. Visit [ISIS](https://isis.tu-berlin.de/) or [Moses](https://moseskonto.tu-berlin.de/moses/index.html). Existing TU tabs may need a reload. Pin the extension to your toolbar to access Pause, Resume and Settings.

Leave credentials empty to automatically follow the normal sign-in flow and reuse an existing SSO session. If TU requires authentication again, enter it yourself or use Firefox's password manager. This mode cannot guarantee unattended login.

**Temporary add-ons are removed when Firefox closes.** For use across browser restarts, build the ZIP and submit it to Mozilla's [Developer Hub](https://addons.mozilla.org/developers/) as an **unlisted / self-distributed** extension. Install the signed XPI Mozilla provides using `about:addons` → gear → **Install Add-on From File…**. Regular Firefox requires Mozilla signing; the ZIP in `dist/` is a submission package, not an installable signed release. See [Mozilla's signing and distribution guide](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

## TOTP setup

Use the Base32 secret used to set up your authenticator, or the full `otpauth://totp/...` URI encoded in the setup QR code. A six-digit OTP expires and is **not** a setup secret. Do not put a real secret into an online QR decoder or this repository. If your authenticator supports exporting an existing entry, you can obtain the secret from that export locally.

The default is HMAC-SHA1, six digits, 30 seconds. An `otpauth` URI can specify SHA256/SHA512, eight digits and a different period. **Preview current OTP** lets you compare with your authenticator without contacting TU. Your computer clock must be correct. The extension waits for a new code when fewer than four seconds remain and never submits the same time step twice in a browser session.

TU explains its procedure and where the setup QR originates in its [TOTP instructions](https://www.tu.berlin/campusmanagement/it-support/zwei-faktor-authentifizierung-tan-verwaltung-totp-token). TAN lists, hardware tokens, push confirmation and CAPTCHA remain manual. Unknown login forms and consent screens are left for you to complete.

## Controls and failures

- **Pause / Resume:** the toolbar popup controls all automatic login. Pauses persist across restarts.
- **Log out:** clicking a recognized logout control pauses automatic login globally until Resume. This keeps the extension from immediately signing you back in.
- **Errors:** recognized login errors pause automation. Fix the credentials or check the TU page, then Resume. The extension also blocks repeated attempts to the same step and limits password and OTP submissions to three each per ten minutes across tabs. Resume clears attempt limits explicitly; it does not permit reusing the same OTP.
- **Service switches:** ISIS and Moses switches control automatic entry into SSO on those sites. The main enable switch and toolbar Pause also stop automation on the central SSO page.
- **Delete saved settings & credentials:** clears the account details and pauses automation. It does not log out an already authenticated TU session.

## Credential handling and permissions

Unattended login after restarting Firefox requires recoverable credentials. **The password and TOTP seed are stored unencrypted in this extension's `browser.storage.local` in your Firefox profile.** They are not protected by Firefox's Primary Password. Saving both factors in one profile reduces their separation: someone who can read or use the profile can use both. Use only a private, trusted profile; full-disk encryption protects it when your device is off. You can choose SSO-only mode instead.

- No analytics, remote code, third-party requests, telemetry, external backend or `storage.sync`.
- Credentials are filled only in recognized POST login forms on **`https://shibboleth.tubit.tu-berlin.de/idp/profile/...`**, with checked form and submit-button destinations. The TOTP seed stays in the background context; only a generated code reaches a page.
- Content scripts run in the top frame on the exact ISIS, Moses and Shibboleth hosts. No wildcard access to other TU subdomains, cookie access, browsing history or web request interception.
- Settings and credential-management messages require an exact extension-owned settings or popup URL. Websites cannot invoke them.
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

`npm start` launches an isolated temporary Firefox profile; change the Firefox binary argument in `package.json` if it is installed elsewhere. The build writes `dist/tu-berlin-auto-login-1.0.0.zip` and includes only `extension/`. Runtime code has no dependencies, no bundler and no network-loaded libraries.

Tests cover RFC 6238 TOTP vectors, URI validation, exact-origin and message authorization, retry limits, pause persistence, login-button selection, named submitters, dynamic Moses navigation, OTP waits, destination changes and representative error/consent/TAN pages.

### Verification limits

The public ISIS login form, its redirect to Shibboleth, the TU username/password form and Moses's current JavaScript login control were inspected on **2026-10-15**. Reduced fixtures preserve their relevant controls. **No real TUB credentials have been used and a live authenticated OTP page has not been inspected**; OTP tests use a representative fixture. If TU uses different OTP markup, the adapter needs updating. Other TU services work only when their flow reaches the supported Shibboleth form. TU outages, expired SAML flows and mandatory interaction can still interrupt login.

The extension deliberately does not automatically retry a “Stale Request” page or guess new identity-provider domains. Start again from the service's home page, check the toolbar state and Resume if needed.
