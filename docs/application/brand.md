# Kami Grow identity

The owner-selected diagonal two-tone leaf is recreated as clean vector paths in
`apps/web/src/app/icon.svg`. Its flowing split, short rounded stem and sage upper /
forest lower halves follow the [refined leaf design handoff](https://github.com/haggaikaunda/kami-split/issues/327#issuecomment-6232127719).
The original concept and transparent adaptation were AI-generated for the owner;
the production paths are a manual vector recreation, without embedded raster data.
The handoff ZIP SHA-256 is
`01f0a634aff055833612cad784879f98043430ee74c05fe6c711c8f5d93cb6cf`.

`components/brand.tsx` is public presentation: live “Kami Grow” text and a
decorative mark. Workspace, onboarding and initial loading share it. It owns no
session, private data, navigation or theme lifecycle. Existing containing links
supply native keyboard behavior and get their accessible name from the live text.
The compact workspace mark is 32px; onboarding uses 43px.

Light uses sage `#87aa92` and forest `#17634d`. The application mark uses deliberate
lighter dark colors `#a3c7ae` and `#59a98b` under the existing resolved `data-theme`;
System changes continue through the existing appearance owner. The standalone SVG
favicon follows the browser's system color scheme. Installation PNGs use the light
palette on an opaque pale `#edf2ef` canvas with extra padding for corner masks.
Manifest identity, scope and launch routing remain independent of these assets.

After editing the canonical SVG, run from the repository root with the pinned
Node/pnpm dependencies installed:

```sh
node apps/web/scripts/generate-brand.mjs
```

The generator uses Next.js's pinned Sharp dependency and produces
`components/brand-mark.tsx`, `src/app/apple-icon.png`, and the 192/512px PNGs in
`public/icons/`. Commit these generated sources with the SVG. Keep explicit
application theme colors in `components/brand.module.css` aligned with the SVG's
standalone palette. Inspect the rendered silhouette at normal/enlarged sizes,
16/24/32px favicon sizes, both themes and the installation exports after changes.
Native installed-device behavior requires a separate device check; browser
metadata and PNG rendering do not establish that behavior.
