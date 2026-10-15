# Privacy

TU Berlin Auto Login is an independent, local Firefox extension. It has no developer-operated backend and sends no analytics or diagnostic reports.

If you save credentials, your TUB username, password and optional TOTP secret are stored unencrypted in the extension's local Firefox profile storage. They are not placed in Firefox Sync by this extension. The secret is used locally to generate time-based codes.

During normal login, the extension fills your username, password and/or a generated code into recognized login forms on `https://shibboleth.tubit.tu-berlin.de`. If TUB-Guest is enabled, it also fills username/password on the exact `https://radius-01.tu-berlin.de:8443` guest portal. With automatic AGB acceptance enabled, it submits agreement to that network's acceptable-use terms. TU processes these under its own policies. The TOTP setup secret is not submitted to TU or any third party by the extension. Visiting and signing in to ISIS, Moses or the guest portal causes their normal website requests and session-cookie processing.

The extension stores preferences and a pause reason locally, plus temporary attempt timestamps, step identifiers, tab IDs and the last used OTP counter for retry protection. It does not retain browsing history, SAML payloads, page contents or URL query strings other than the SSO execution identifier used temporarily for duplicate prevention.

The optional Linux native helper reads active NetworkManager Wi-Fi SSIDs, connection identifiers and IP addresses locally to find TUB-Guest. It sends credential-free HTTP detection requests through the associated Wi-Fi adapter to `firefox-portal-detection.com`, with fallback probes to `captive.apple.com`, `www.msftconnecttest.com` and Cisco's local retry address `192.0.2.123`; a captive network may intercept them. It returns only a connection fingerprint, interface name, status and a verified TU portal URL to the extension. Passwords and OTPs are never sent to the helper. The connection fingerprint is held only in extension session storage to avoid duplicate portal tabs. Device-specific portal session URLs are used to navigate to TU but are not persisted in extension settings or logged by the helper. Firefox may retain the visited URL in its ordinary browsing history.

You can delete stored credentials and settings from the extension's settings page. Delete or uninstall the extension to remove its storage through Firefox; backups of your Firefox profile may retain copies. Deleting credentials does not end an existing TU website session. Use TU's logout control to do that.
