# Privacy

TU Berlin Auto Login is an independent, local Firefox extension. It has no developer-operated backend and sends no analytics or diagnostic reports.

If you save credentials, your TUB username, password and optional TOTP secret are stored unencrypted in the extension's local Firefox profile storage. They are not placed in Firefox Sync by this extension. The secret is used locally to generate time-based codes.

During normal login, the extension fills your username, password and/or a generated code into recognized login forms on `https://shibboleth.tubit.tu-berlin.de`. TU processes these under its own policies. The TOTP setup secret is not submitted to TU or any third party by the extension. Visiting and signing in to ISIS or Moses causes their normal website requests and session-cookie processing.

The extension stores preferences and a pause reason locally, plus temporary attempt timestamps, step identifiers, tab IDs and the last used OTP counter for retry protection. It does not retain browsing history, SAML payloads, page contents or URL query strings other than the SSO execution identifier used temporarily for duplicate prevention.

You can delete stored credentials and settings from the extension's settings page. Delete or uninstall the extension to remove its storage through Firefox; backups of your Firefox profile may retain copies. Deleting credentials does not end an existing TU website session. Use TU's logout control to do that.
