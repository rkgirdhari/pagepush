# Page Push companion website

This is the separate, static Manus-managed companion website for the Page Push extension. It explains the extension, its local setup, review workflow, privacy practices, and unreleased status. It does not include the extension source or provide a download or checkout.

## Local preview

The website has no package dependencies. With Node.js installed, run `node dev-server.mjs` from this directory. The preview binds to `127.0.0.1` and reads the `PORT` environment variable, defaulting to 3000. In the Manus desktop session the managed development command owns the preview process.

The static output is `public/`; `public/index.html` is the homepage, `public/privacy/index.html` is the extension policy, and `public/manus-routes.json` enumerates the public page routes. `node --check dev-server.mjs` checks the preview server syntax. No public canonical address is specified before a real site origin is chosen.

## Maintenance

Keep the privacy page aligned with the extension's `../PRIVACY_POLICY.md`, and update the release-status text when the live verification, multi-panel deletion issue, and store requirements actually change. The publisher must provide a public contact and review the policy before a store submission. A Manus checkpoint is not publication; publication is a separate user-controlled action.
