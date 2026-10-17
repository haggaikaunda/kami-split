# Home Screen application

Kami Grow declares one installed application for every path on its current
origin. Next.js serves `apps/web/src/app/manifest.json` and links it from the
shared root layout, including authentication and nested financial pages.

- `scope: "/"` keeps all same-origin app routes inside the installed app's scope.
- `start_url: "/groups"` selects the launch screen; it does not limit navigation.
- `id: "/"` gives installations from different pages the same declared identity.
- `display: "standalone"` requests the app presentation without browser controls.

Verified sessions retain the `/` redirect to `/groups`; signed-out visits go to
`/sign-in` first under the [authentication boundary](web-auth-routing.md).
The manifest and the three installation PNGs are explicitly public resources,
so installation never depends on a session cookie or Auth provider availability.
Other asset-shaped paths remain protected. Legacy `/join`, `/auth/confirm`, and
`/auth/password` URLs hand off to fixed sign-in flows that share the metadata.
Users can install from Household,
Groups, Trips, or Account without first bookmarking the bare domain. External
origins remain outside the app's scope; ordinary browser tabs retain browser UI.
This configuration adds no service worker, offline storage, or financial caching.

The root layout supplies Apple capability/title metadata. Next.js discovers the
180px `apple-icon.png`; the manifest uses 192px and 512px PNGs under
`apps/web/public/icons`. All three are rasterizations of the existing
`apps/web/src/app/icon.svg`, flattened onto its `#c3eee0` background for opaque
installation icons. Keep these assets aligned if the brand icon changes.

## Installation and verification

In iPhone Safari, open the deployed site, choose Share → Add to Home Screen,
enable **Open as Web App** when available, and launch from the Home Screen icon.
Existing shortcuts may retain prior installation settings. Verify changed
metadata using a fresh installation; removing an existing installation can remove
its local session or unsaved drafts, so finish pending work and expect to sign in
again first.

Repeat installation from `/trips` and `/household`. From each, visit Household,
Groups and Profile, open a Trip through Groups, and exercise Add expense, nested
workspace and expense-detail Back navigation, and sign-in/return flows. Close and
relaunch; check portrait/landscape safe areas.
Record the iPhone model, iOS version, deployed revision, and results on the PR.
Server metadata and desktop automation cannot prove the iPhone's installed-app
presentation or refresh behavior.

The opt-in regression uses the synthetic fixture and setup documented in
[workspace loading](../navigation/workspace-loading.md):

```sh
INSTALLATION_TESTS=1 BROWSER_ORIGIN=http://YOUR_LAN_IP:4200 WIDTH=390 SCALE=1 \
  PLAYWRIGHT_MODULE=/path/to/playwright node scripts/navigation-browser.cjs
```

It checks shared server-rendered metadata across app routes with a synthetic verified session and
expected legacy sign-in handoffs, cookie-free manifest/PNG GET and HEAD responses,
PNG dimensions, signed-out and verified root redirects, keyboard navigation from both entry
pages, and expense-detail Back navigation. It does not install an iOS web app or
test real authentication/financial services.
