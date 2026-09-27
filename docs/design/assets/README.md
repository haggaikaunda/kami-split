# Reference assets

The executable design asset is the checked-in [prototype](../prototype/). No user-supplied Downloads files or credentials are embedded in the repository. The two concept screenshots discussed in the design conversation are inspiration; the consolidated specification and prototype capture the approved decisions without requiring those local files.

- Maui sample cover: [Jordan McQueen / Unsplash](https://unsplash.com/it/foto/onde-del-mare-che-si-infrangono-sugli-scogli-durante-il-giorno-u5hob7DWLbQ), image identifier `photo-1616398377801-d6a1a8705c98`.
- Tahoe sample cover: [Peter Hulce / Unsplash](https://unsplash.com/photos/a-rocky-shore-with-clear-blue-water-and-mountains-in-the-background-nNCdDwX-lBY), image identifier `photo-1647285471436-9d1b1e9d6e47`.
- Porto/new trips: abstract default cover, no uploaded image required.
- Typography: Manrope headings and DM Sans body, with local/system fallback. The prototype requests Google Fonts; production delivery must choose a reviewed loading strategy and preserve readable fallback text.
- Icons: simple inline line icons in the prototype, with category color as a secondary cue. Production may use a consistent accessible icon library or equivalent SVGs; decorative icons are aria-hidden, actionable icon-only controls need names.

Photo URLs are external reference dependencies, not offline assets or guaranteed availability. Verify reuse terms before bundling any remote asset, preserve attribution, and use a local deterministic neutral fallback in automated tests. Do not fetch fresh random imagery for acceptance screenshots. Derive tokens from the approved surface, not from the prototype's accumulated CSS overrides.
