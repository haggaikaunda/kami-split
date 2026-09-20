# Shared UI primitive examples

Issue [#16](https://github.com/haggaikaunda/kami-split/issues/16). This standalone development gallery exercises controls and states without adding application routes or implying that example buttons persist records.

Run `pnpm exec vite docs/primitives-preview --host 127.0.0.1 --port 4176`, then open `http://127.0.0.1:4176`. Vite is supplied by the existing Vitest toolchain. Use the labeled **Example text size** selector to switch between 100% and 200% root text size directly in the gallery. No application runtime dependency was added; jsdom is a development dependency for component interaction tests.

## Contract

- `Field` / `SelectField` provide visible labels and combine caller descriptions, hints and inline errors. Pass `inputMode="decimal"` for money, `type="date"` for dates, and stable member IDs as select values. `ErrorSummary` focuses the first invalid field when its first field changes; its links also focus the matching control.
- `Button` defaults to `type="button"`. Forms explicitly opt into submit. Pending disables repeat activation; operation IDs and mutation correctness belong to the adapter.
- `Money` accepts exact domain-formatted text and a visible currency. It performs no arithmetic or rounding. `ChartTable` likewise preserves exact text; its magnitude controls geometry only. Pass values and magnitudes from the same domain record. The table is equivalent to the bars, and zero bars remain selectable.
- `Dialog` uses the native modal top layer with an explicit Tab/Shift+Tab edge loop. It initially focuses its heading, or a supplied initial focus ref. Escape requests controlled closure. Cleanup restores a supplied surviving return target, the original trigger, or the surviving main/body fallback. Confirmation defaults to its safe action. Consumers own dirty-draft and pending-operation policy.
- Dialogs become full-screen below 760px; panels align to the right on larger screens. Phone padding respects safe areas and content scrolls inside the viewport. On-screen keyboards must still be checked during journey integration on target mobile devices.
- `Member` uses initials on missing or failed photos. No external images or fonts are bundled or requested. Manrope and DM Sans are preferred font names with immediately usable system fallbacks; reviewed font delivery can be added later.
- Status labels explicitly distinguish pending, error, stale and unavailable states; color is supplementary. Skeletons announce loading without fabricated financial values. Toasts announce feedback, but are not proof of a mutation.

## Verification recorded September 20, 2026

Component interaction tests cover field/error associations, summary focus, duplicate pending clicks, dialog naming/Escape/Tab wrapping, safe confirmation focus, trigger removal and focus restoration, failed photos, zero-period selection, and exact chart/table text.

Headless installed Chrome rendered 320px, 390px and 1280px at both 100% and 200% root text size. All six combinations had document width equal to viewport width; visible buttons/fields were at least 44px and had no internal content overflow. Exact tables use a labeled, keyboard-focusable scrolling region at narrow sizes. Screenshots were inspected for readable content, wrapping, and usable fallback typography/photos:

- [320px at 200% text](screenshots/320-200-percent.png)
- [390px](screenshots/390.png)
- [1280px](screenshots/1280.png)
- [390px dialog / keyboard focus](screenshots/dialog-390.png)

In Chrome, twelve successive Tab and Shift+Tab presses each remained inside the dialog; Escape closed it and restored the opening button. Confirmation focused Keep editing. The intentionally missing photo showed AM initials.

Manual token review with WCAG relative-luminance calculations: ink/white 13.42:1, muted/white 6.29:1, white/primary 7.92:1, white/destructive 7.52:1, error/error-surface 6.78:1, focus/white 6.41:1, control-border/white 3.10:1. Disabled controls remain semantically disabled. Screenshots exercise the system-font fallback without a font service and a failed photo request.

The gallery does not cover authentication, transport, concurrency, persistence, or complete journeys. Those remain later issue work.
