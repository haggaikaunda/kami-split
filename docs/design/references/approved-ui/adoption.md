# Remaining screen adoption (#189)

This slice carries the approved Board A/B foundation into onboarding, Household balances, Group/Trip overview and balances, repayment, expense detail/create, and inherited Activity/Members/discovery/account states. It preserves the existing server-owned authentication, authorization, money and recovery contracts.

## Component rules and deliberate differences

The shared foundation supplies the leaf wordmark, real destination navigation, 4px spacing scale, forest actions, warm canvas, white cards, quiet separators and line icons. Local scenic art distinguishes Trips; ordinary Groups use neutral cottages. Member initials retain accessible names and full-name tooltips. Onboarding uses the same cottage asset and white form panel. Art has reserved geometry, CSS fallback colors and decorative-only semantics.

Expense detail emphasizes the category, exact total and payer, then lists the authoritative allocations and note/audit fields. Form cards retain the existing required payer, allocation, category and date inputs. Explicit source selection remains available in Household creation. No search, receipts, edit/delete, saved filters or status controls are introduced.

Household retains all three server metrics and independent source balances. Groups retain two metrics, all member positions and every simplified obligation. Zero net does not imply group settlement. Repayment keeps the tabs/return navigation needed for retained-attempt recovery; it never transfers money. Long names, large exact values and 200% text may increase card height. These contract/accessibility differences from illustrative board content are intentional.

## Artwork provenance

`apps/web/public/art/trip.png` is a new decorative illustration created with the built-in imagegen tool. It has no UI, people, text or financial state. Household/onboarding art provenance is in [foundation.md](foundation.md).

Prompt: “Use case: illustration-story. Panoramic 3:1 decorative scenic header for a travel expense app. Refined layered paper-cut editorial landscape matching cream cottages and forest/sage trees: turquoise tropical bay, sweeping pale sand shore, lush emerald palms at both edges, distant blue-green volcanic mountains, soft clouded pale blue sky and warm sunlight. Crisp elegant simplified shapes with subtle paper texture, calm grown-up travel illustration. No people, no text, no UI, no typography, no watermark. Composition retains a quiet darker green lower-left zone for real white HTML title text. Forest, emerald, sage, muted blue, sand and cream palette.”

## Verification

Baseline source is `c1b403781b632cf6b9c51b13633dd0550b424d1e`, the merged visual foundation. Final source and the per-panel evidence matrix are recorded below after capture. Browser tests intercept Auth/GraphQL with isolated synthetic records and render the real production application. They prove client behavior/layout; server authorization and database invariants remain covered by the required API/database CI. Physical notches and assistive-technology devices are not simulated as actual hardware.
