# Permanent Firefox installation on your computers

Use a **Mozilla-signed XPI** for desktop Firefox 142+ on Windows, macOS or Linux. It stays installed after browser and computer restarts. You can reuse the same signed XPI on every computer; only the person submitting it to Mozilla needs a developer account. The optional second-Wi-Fi-adapter helper is separate and Linux-only.

The ZIP produced by this repository is an **unsigned submission package**. Renaming it to `.xpi` does not sign it. Loading `manifest.json` through `about:debugging`, including with `npm start`, is temporary. No signed installer has been checked into this repository. Mozilla signing/review must finish before permanent installation in regular Firefox.

## First time: create your account and get the signed installer

1. Open [addons.mozilla.org](https://addons.mozilla.org/), choose **Register** and create a Mozilla Account (or sign in to an existing one). Verify your email and complete any account verification Mozilla requests. This is separate from your TU account.
2. Open the [Add-ons Developer Hub](https://addons.mozilla.org/developers/) and choose **Submit Your First Add-on** / **Submit a New Add-on**. Read and accept Mozilla's developer agreement yourself.
3. Choose **On your own** (self-distributed / unlisted). This gives you a signed installer without publishing a public add-on listing.
4. Prepare the upload ZIP in either of these ways:
   - **Without installing development tools:** open this repository's [Firefox installer workflow](https://github.com/technickfreak2000/tu-buddy/actions/workflows/firefox-installer.yml), click **Run workflow**, leave **Sign with Mozilla** unchecked, and run it on `main`. Once it succeeds, download the **firefox-unsigned-submission** artifact from the run's summary. **Extract that artifact ZIP**; upload the inner `tu-berlin-auto-login-1.4.2.zip`, not GitHub's outer artifact wrapper.
   - **Locally:** run `npm ci`, `npm test`, `npm run lint` and `npm run build` in the checkout. Upload `dist/tu-berlin-auto-login-1.4.2.zip`. Building requires Node.js 22.22.2+ (or current Node 24/26), Python 3 for tests, and the `zip` command. Windows users can use the workflow or WSL.
5. Upload the submission ZIP to Mozilla and follow validation/submission prompts. All runtime JavaScript is readable and included in the package; there is no minification, transpilation, bundler or separate generated-source archive. If asked for licensing, use **GNU General Public License v3.0**, as in [LICENSE](LICENSE). If asked for privacy details, use [PRIVACY.md](PRIVACY.md). The extension optionally sends saved credentials and generated OTPs to TU's login servers; it has no developer-operated backend. Do not include your actual TU credentials or TOTP secret in submission forms or review notes.
6. Wait for signing/review to finish. From the add-on's version in Developer Hub, **download the signed `.xpi`**. This is the file to install and share. If Mozilla reports validation or review issues, resolve those before installing; the unsigned ZIP is not a substitute.

Mozilla's instructions: [Signing and distribution](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/), [submitting an add-on](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/).

## Install on this computer and your other computers

1. Save the **signed `.xpi`** on the computer. You can copy it by USB or your usual file-transfer method. It contains code, not your saved login details.
2. In Firefox, open `about:addons`. Use the gear menu → **Install Add-on From File…**, select the signed XPI and click **Add** after reviewing permissions. If a temporary copy is currently loaded, restart Firefox first to unload that copy. This will close browser windows, so finish any work first.
3. Open **TU Berlin Auto Login → Preferences/Settings** and enter your TU username, password and optional TOTP setup secret. Configure each Firefox profile separately; this extension does not sync credentials between computers. If this profile already retains settings for `tu-auto-login@local.nick`, check those settings before entering anything again.
4. Restart Firefox when convenient and check `about:addons`: TU Berlin Auto Login remains installed. Visit ISIS, Moses or TUport to use it.

Keep the extension ID **`tu-auto-login@local.nick`** when updating. The signed and temporary versions use that same ID. Do not uninstall an existing copy just to update; uninstalling can delete its stored settings. The password and TOTP seed are stored unencrypted in that Firefox profile; Firefox's Primary Password does not protect this extension's storage.

For detection through a second Wi-Fi adapter on Linux, also run `python3 native/install.py` from this repository **on each relevant computer**, then restart Firefox when convenient. See [the helper instructions](README.md#tub-guest-and-a-second-wi-fi-adapter). Ordinary login and video downloads do not require that helper. Windows/macOS do not have the secondary-adapter helper.

See Mozilla's [install-from-file instructions](https://extensionworkshop.com/documentation/publish/install-self-distributed/).

## Optional: sign future versions with GitHub Actions

The manual Mozilla upload above is sufficient; API credentials are optional. For repeatable builds after that first submission:

1. While signed in to the **same Mozilla account that owns the add-on**, open [AMO API credentials](https://addons.mozilla.org/developers/addon/api/key/) and generate credentials.
2. Open this repository's [Actions secrets settings](https://github.com/technickfreak2000/tu-buddy/settings/secrets/actions). Add two **repository secrets**:
   - `AMO_JWT_ISSUER`: Mozilla's **JWT issuer**.
   - `AMO_JWT_SECRET`: Mozilla's **JWT secret**.
3. Open [Actions → Firefox installer](https://github.com/technickfreak2000/tu-buddy/actions/workflows/firefox-installer.yml), choose **Run workflow**, select `main` and check **Sign with Mozilla**. The workflow runs tests, lint and build, then uploads the extension to Mozilla's unlisted signing channel. Secrets are passed only to the signing step. No signing runs automatically on pushes or pull requests.
4. When successful, download the **firefox-signed-installer** artifact, **extract the outer GitHub artifact ZIP**, and install the contained `tu-buddy-<version>.xpi` using the steps above. You can keep and share that XPI independently of GitHub's artifact retention period. The unsigned-submission artifact is also available, with a different name.

Never put these API credentials in a commit, issue, chat or extension settings. They are Mozilla publishing credentials, unrelated to your TU account or TOTP seed. GitHub documents [how to add repository secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).

For local signing, provide `WEB_EXT_API_KEY` (JWT issuer) and `WEB_EXT_API_SECRET` (JWT secret) through your shell's secure environment handling, then run:

```sh
npm run sign:firefox
```

This requires `zip` and `unzip`, rebuilds the submission package, stages only its contents in a temporary directory and saves Mozilla's returned XPI unchanged under `dist/`. API credentials are not included in arguments or the extension. Signing can take time; after a timeout or a pending review, check Developer Hub for the existing submission rather than uploading that same version repeatedly.

## Updating installed copies

Before submitting changed code again, increase the version in `extension/manifest.json`, `package.json` and `package-lock.json`. Mozilla does not accept reusing an already submitted version for different code. Keep the existing extension ID.

Sign the new version, then install its signed XPI through `about:addons` on each computer. Firefox updates the existing add-on and keeps its settings. **This unlisted setup does not configure automatic updates**; installing another copy elsewhere does not update your other computers. A public AMO listing or a separately maintained update manifest would be needed for automatic distribution of updates.
