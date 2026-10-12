# Reference assets

Current production visual acceptance follows [issue #227 and its commit-pinned reference pack](../issue-227-parity-matrix.md), with the exact source palette, original banner artwork and system-font typography as updated in #237. The earlier [Board A/B references](../references/approved-ui/README.md), checked-in [prototype](../prototype/) and asset notes below preserve historical design provenance. They do not override the current visual authority or product/API contracts.

- Maui sample cover: [Jordan McQueen / Unsplash](https://unsplash.com/it/foto/onde-del-mare-che-si-infrangono-sugli-scogli-durante-il-giorno-u5hob7DWLbQ), image identifier `photo-1616398377801-d6a1a8705c98`.
- Tahoe sample cover: [Peter Hulce / Unsplash](https://unsplash.com/photos/a-rocky-shore-with-clear-blue-water-and-mountains-in-the-background-nNCdDwX-lBY), image identifier `photo-1647285471436-9d1b1e9d6e47`.
- Porto/new trips: abstract default cover, no uploaded image required.
- Historical prototype typography: Manrope headings and DM Sans body, requested from Google Fonts. The historical #227 implementation bundled Roboto; #237 uses system fonts; see the [implementation note](../issue-227-implementation.md).
- Icons: simple inline line icons in the prototype, with category color as a secondary cue. Production may use a consistent accessible icon library or equivalent SVGs; decorative icons are aria-hidden, actionable icon-only controls need names.

Photo URLs are external reference dependencies, not offline assets or guaranteed availability. Verify reuse terms before bundling any remote asset, preserve attribution, and use a local deterministic neutral fallback in automated tests. Do not fetch fresh random imagery for acceptance screenshots. Derive tokens from the approved surface, not from the prototype's accumulated CSS overrides.
