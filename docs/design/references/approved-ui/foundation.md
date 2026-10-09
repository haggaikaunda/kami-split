# Shared visual foundation (#189)

> Historical visual rules and evidence, superseded for current production by [#227](../../issue-227-implementation.md). In particular, the Manrope/DM Sans, warm palette, wide navigation and card measurements below are earlier implementation choices, not current authority. Original artwork provenance and historical evidence remain unchanged.

This is the historical #191 slice record. The subsequent [remaining-screen adoption](adoption.md) supplies the outstanding panel evidence; the current [acceptance ledger](README.md) indexes both slices.

This slice applies Board A2/A6 and B1/B6 to the real Household Overview and Expenses routes, and B5/B7 to shared structured filters. Other mapped surfaces remain pending full adoption. Shared primitive changes also affect existing Group/Trip screens and retain their regression requirements.

## Component rules

- Warm canvas `#f8f7f3`, white cards, forest action `#00664d`, ink `#163744`, secondary slate `#566a80`; warm-clay owes remains separate from destructive errors.
- Existing Manrope/DM Sans remain local. Headings use 24–32px, metrics 16–24px, supporting copy 13–14px at the default 16px root. All scale with root text; controls retain 44px targets.
- Spacing follows the existing 4px scale. Controls use 8px radius, cards 12px, 1px quiet separators. Desktop navigation is 208px, the page has a 1248px maximum, and mobile navigation reserves bottom safe-area space.
- Household metrics retain all three supported server totals in one horizontal row. Exact money permits breaks after grouping commas; extreme narrow layouts may wrap without truncation. No floating-point money calculations are introduced.
- Shared line SVGs replace arbitrary category symbols. Initials remain the existing avatar fallback. Household header decoration is visible on desktop; phone composition follows A6's compact identity without artwork behind text.
- Structured filters use the existing native modal dialog at all widths. Reset edits the draft; Apply updates the URL. Existing detail/create navigation, recovery and account ownership remain unchanged.

## Artwork provenance

`apps/web/public/art/household.png` is a new decorative asset created with the built-in imagegen tool for this project. It is independent from the original approved boards. It contains no UI, text, people or financial state. CSS supplies a white fallback, reserved geometry and decorative-only semantics.

Prompt: “Use case: illustration-story. Create a wide decorative illustration for Kami Split's Household header. Warm paper-cut editorial style, elegant flat layered shapes, matching a refined expense-sharing app: a small cluster of cream cottages with terracotta roofs nestled among tall forest-green and sage trees, soft pale blue distant hills. Warm ivory background #f8f7f3. Panoramic 3:1 composition, houses and trees concentrated on the right half and abundant quiet ivory space on the left for real UI text. No text, no typography, no labels, no UI, no border. Palette forest/emerald, sage, sand, cream and restrained muted blue. Crisp refined shapes with subtle paper texture. This is a decorative local asset, not a screen mockup.”

## Verification

Final PR evidence records exact commits and browser screenshots. Synthetic browser responses exercise real production components; they do not establish backend authorization. Preserve the original published boards as the visual target. No entire issue acceptance is claimed by this focused foundation slice.

## Browser comparison

Baseline: production source `19897a1` (reference-only commit `85e6e47`), final source: `de43639`. Screenshots use isolated synthetic Auth/GraphQL responses, never private production records. The stress cases retain long names and unusually large exact amounts; ordinary-content images supplement them.

| Route / panels                    | Baseline                                                 | Final stress                                          | Final ordinary content                                  |
| --------------------------------- | -------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| `/household`, A2 desktop          | [1280px](evidence/foundation/baseline-overview-1280.png) | [1280px](evidence/foundation/final-overview-1280.png) | [1280px](evidence/foundation/regular-overview-1280.png) |
| `/household`, A6 mobile           | [390px](evidence/foundation/baseline-overview-390.png)   | [390px](evidence/foundation/final-overview-390.png)   | [390px](evidence/foundation/regular-overview-390.png)   |
| `/household/expenses`, B1 desktop | [1280px](evidence/foundation/baseline-expenses-1280.png) | [1280px](evidence/foundation/final-expenses-1280.png) | [1280px](evidence/foundation/regular-expenses-1280.png) |
| `/household/expenses`, B6 mobile  | [390px](evidence/foundation/baseline-expenses-390.png)   | [390px](evidence/foundation/final-expenses-390.png)   | [390px](evidence/foundation/regular-expenses-390.png)   |

The [evidence directory](evidence/foundation/) additionally includes 320px and 768px captures. Household browser regression: 152 checks across all four widths and 100/200% root text. Expense browser regression: 16 Household/Group configurations across all four widths and 100/200% text, checking horizontal summaries, no document overflow, complete month totals/pagination, keyboard Back/Forward and focus/scroll restoration, filtered-empty, exact synthetic creation/return, hidden stale detail and access denial. No browser runtime errors. Independent review evidence and any limitations are recorded on the PR.

The boards' unsupported search/receipts/status/saved-filter controls remain absent. Every current metric remains available; this makes phone summaries denser than the generated two-card artwork. Long descriptions and extreme money intentionally increase row/card height; values are never truncated. Navigation uses only the real Household, Groups, Trips and Account destinations. Final whole-issue visual acceptance remains pending the other surfaces.

Filter comparison: [desktop baseline](evidence/foundation/baseline-filter-1280.png) / [desktop final B5](evidence/foundation/final-filter-1280.png), [mobile baseline](evidence/foundation/baseline-filter-390.png) / [mobile final B7](evidence/foundation/final-filter-390.png). Original baseline filters were captured from a separately built unmodified `19897a1` checkout. Independent final modal checks cover forward/reverse Tab, draft Reset, Apply, Escape and trigger restoration at four widths and both root text sizes. The shared header also has [Group 320px regression evidence](evidence/foundation/group-regression-320.png); full Group visual adoption is still pending.
