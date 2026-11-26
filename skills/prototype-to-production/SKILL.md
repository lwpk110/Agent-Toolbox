---
name: "prototype-to-production"
description: >-
  Framework-agnostic engineering workflow for faithfully replicating interactive
  HTML/CSS/JS prototypes, OpenDesign exports (DESIGN-HANDOFF.md /
  DESIGN-MANIFEST.json), or static visual mockups into any production frontend
  stack (React, Vue 3, Svelte, Angular, Next.js, or Vanilla JS / Web
  Components). Enforces visual-contract precedence, CSS token freezing,
  1:1 DOM & state anatomy mapping, production data-binding boundaries,
  multi-viewport verification, and recursive self-improvement.
---

# Prototype-to-Production Frontend Replication Skill

Use this skill whenever an existing prototype directory (e.g., `protype/`, `prototype/`, `design/`, OpenDesign HTML/CSS/JS handoff, or static mockup) must be ported into production frontend code—regardless of whether the target stack is **React, Vue, Svelte, Angular, Next.js, or Vanilla JS / Web Components**.

---

## 0. Precedence & Anti-Drift Constitution

When converting an explicit prototype into production code, resolve all conflicts in this strict order:

1. **Explicit Prototype Contract Wins Over Generic Aesthetic Rules**
   - The prototype's HTML, CSS, JS, `DESIGN-HANDOFF.md`, and `DESIGN-MANIFEST.json` are the **Single Source of Truth** for appearance and baseline interaction.
   - **Explicit Override**: If a generic design guideline (such as "zero-pill", "no status dots", "no left accent stripes", "strip header icons", or "replace system fonts with Google display fonts") conflicts with the prototype's explicit CSS/HTML, **follow the prototype**. Never "sanitize" or restyle signature prototype elements.
2. **Preserve Before Refactoring**
   - First match the prototype's exact pixels, layout geometry, typography, color tokens, icons, copy, and interactive states (`aria-current`, `aria-pressed`, `aria-checked`, `aria-expanded`, `aria-selected`, `disabled`).
   - Only replace in-memory prototype data (`window.MOCK`, hardcoded arrays) with real backend APIs, persistent stores, or streaming events.
3. **Zero Unsolicited Chrome**
   - Do not inject widgets, theme toggles, extra buttons, latency tags, or layout wrappers that do not exist in the prototype unless explicitly requested by the user.
   - When production requires extra functionality beyond the prototype (e.g., a real "Create" modal for a prototype stub button, or an extended documentation portal), attach it behind existing trigger buttons or non-intrusive secondary controls so the default rendered viewport stays 1:1 faithful.

---

## 1. Phase 1 — Prototype Forensics & Contract Extraction

Before writing a single line of production code, inspect the prototype completely and build three inventories:

### A. Surface & Entry Inventory
- Read `DESIGN-HANDOFF.md` and `DESIGN-MANIFEST.json` (if present) to identify:
  - The **primary entry screen** (`index.html`) vs. auxiliary files (e.g. style comparison galleries `styles/*.html`, wireframes, design specs). Never blend two competing style files together.
  - All views/routes and sub-tabs.
- Read the prototype's canonical CSS (`assets/app.css`, `base.css`, etc.) and JS (`assets/app.js`, `assets/data.js`) in full.

### B. Canonical Token Freeze Table
Extract every exact token from `:root` and global rules—never eyeball or approximate with generic framework palettes (e.g. never swap `#d0d7de` / `#eaeef2` / `#f6f8fa` for Tailwind `neutral-200` / `gray-100`):
- **Colors**: canvas, subtle surface, inset/hover, border, row divider, primary ink, muted ink, link/accent, primary action, semantic status (`ok`, `warn`, `bad`), indicator marks (`--tab-mark`).
- **Typography**: exact `font-family` stack (including whether native system fonts are intentionally used instead of web fonts!), mono stack, exact size scale (`12/13/14/16/20/24/32px`), weights (`400/500/600`), line-heights, `font-variant-numeric: tabular-nums`.
- **Geometry & Rhythm**: shell constants (`--top-h`, `--side-w`, `max-width`), spacing scale (`4/8/12/16/24/32/40/48px`), border radii, box shadows, transitions.
- **Breakpoints**: every `@media` threshold and layout mutation (e.g. hiding nav icons at `1280px`, 3-col → 2-col → 1-col grids, hiding sidebar at `960px`).

### C. Component & Interaction Anatomy Inventory
Catalog every reusable CSS primitive and stateful pattern:
- Shell (`header.top`, `.brand`, `nav.nav`, `aside.side`, `main.main`)
- Containers (`.page-h`, `.box` / `.box-h` / `.box-b` / `.box-f`, `.flash`, `.stats` / `.stat`)
- Controls (`.btn` variants, `.seg` segmented buttons, `.sw` switches, `.tip` info triggers, `details.more` disclosures, `.input` / `select.input`)
- Domain modules (topology diagrams, middleware pipelines, hierarchical expandable tables, master-detail lists, search result groups, step simulators, report/TOC prose)
- Overlays (`dialog.dlg` native modal + `::backdrop`, `.toast` live status notification)
- Accessibility & micro-behaviors (focus restoration after modal/action, keyboard Enter/Space on clickable table rows, IME `isComposing` handling on search inputs, `prefers-reduced-motion`).

---

## 2. Phase 2 — CSS & Token Preservation Strategy (Framework-Agnostic)

Choose the cleanest styling strategy that guarantees **0% token drift** in the target stack:

1. **Strategy A — Canonical Design-System Stylesheet (Recommended for Highest Fidelity)**
   - Port the prototype's `:root` tokens, `@layer` layout primitives, and semantic component classes verbatim into a dedicated design-system CSS module/file imported by the production app (e.g., `src/styles/prototype-system.css` or `src/index.css`).
   - **Coexistence with Utility Frameworks (Tailwind CSS v4 / Bootstrap / UnoCSS)**:
     - Beware CSS cascade & Preflight resets! Tailwind v4's `@layer base` resets `h1..h4`, `button`, `dialog`, `ul`, `p`, and margins.
     - Place prototype base/reset rules inside `@layer base` (or after Tailwind imports with explicit rules on semantic classes like `.box`, `.btn`, `.top`, `.page-h h1`, `dialog.dlg`) so utility resets never strip prototype padding, borders, font-size, or dialog centering (`margin: auto`).
     - If Tailwind is used for supplementary production-only modals/extensions, bind Tailwind theme tokens or use the exact prototype semantic classes (`.btn`, `.field`, `.input`, `.box`, `.dlg`) so extensions look native to the prototype.
2. **Strategy B — Scoped / CSS-in-JS / Component Styles (Vue SFC `<style>`, Svelte `<style>`, Angular component CSS)**
   - Keep `:root` tokens and shared layout primitives in global `tokens.css`.
   - Move component-specific rules into component stylesheets while preserving exact selectors, `aria-*` attribute hooks (`[aria-current="page"]`, `[aria-pressed="true"]`, `[aria-checked="true"]`), and responsive media queries.
3. **Strategy C — Pure Vanilla / Web Components**
   - Keep the prototype CSS nearly untouched; modularize JS into ES modules with a centralized reactive store and targeted re-rendering (or Lit / Custom Elements with adopted stylesheets).

> **Icon Fidelity Rule**: If the prototype defines custom inline SVG paths (e.g. a brand logo mark, `10px` status dots, specific `1.75` stroke-width `24×24` icons), port those exact SVG paths into a shared `<Icon name="..." />` component (or SVG sprite) rather than substituting mismatched icon library shapes or dropping icons.

---

## 3. Phase 3 — Stack-Agnostic Porting Matrix

Read `references/framework-adapters.md` for complete code patterns across **React**, **Vue 3**, **Vanilla JS / Web Components**, **Svelte 5**, and **Angular**. Core translation invariants across all stacks:

| Prototype Primitive | Target Production Invariant (All Frameworks) |
| :--- | :--- |
| `window.STATE` + full `innerHTML` re-render | Centralized reactive store (React state/hook, Pinia/ref, Signals, Vanilla pub-sub) hydrated from real API + SSE/WebSocket |
| `data-act` / `data-ref` global click delegation | Declarative event handlers bound directly on interactive elements; keep native `<button type="button">`, `<a>`, `<input>` |
| `aria-current`, `aria-pressed`, `aria-checked`, `aria-expanded`, `aria-selected` | Bound dynamically to state so every CSS attribute selector (`.nav button[aria-current="page"]`, `.seg button[aria-pressed="true"]`, `.sw[aria-checked="true"]`) works 1:1 without extra class hacks |
| `<dialog class="dlg">` + `showModal()` | Use native `<dialog>` with `showModal()` / `close()` + `cancel` event handling + focus return to trigger element |
| `<details class="more">` | Use native `<details>` / `<summary>` preserving chevron rotation (`details.more[open] > summary .od-icon`) |
| `data-tip` info triggers | Reusable InfoTip trigger button (`.tip`) opening the shared modal dialog with `hideCancel` |
| Prototype toast stub (`data-val="原型演示：..."`) | Wire to real production modals/API endpoints while keeping the trigger button's exact class, icon, label, and placement |

---

## 4. Phase 4 — Verification & Pixel-Parity Audit

Never declare a replication complete after only running `tsc` or `vite build`. Execute a structured parity audit:

1. **Structural & DOM Checklist** (verify every screen against prototype):
   - Header height, brand icon + width alignment with sidebar, nav icons, badge pills (`.count`), active indicator stripe/underline.
   - Sidebar exact width, sticky top offset, section headings, active left border, status dots, copy action, zero extra unsolicited chrome.
   - Main container max-width, outer padding, vertical stack gap, `.page-h` border & lead copy width (`72ch`).
   - Every domain card (`.box-h`, `.box-b`, `.box-f`), table hierarchy (`.svc`, `.bad-row`, `.child` indent), disclosure (`details.more`), segmented control (`.seg`), switch (`.sw`), and empty state (`.empty`).
2. **Computed Style & Viewport Audit**:
   - Inspect in a real or headless browser (when available) or via DOM/CSS audit across at least:
     - Desktop (`1440×900` / `1366×768`)
     - Medium / Tablet (`1024×768` and `<960px` sidebar collapse)
     - Mobile (`390×844` / `560px` single-column stats & pipeline)
   - Verify **zero horizontal overflow** (`scrollWidth <= clientWidth`), exact computed `font-family`, `font-size`, `background-color`, `border-color`, `padding`, and grid column widths.
3. **Interactive & Production Wiring Audit**:
   - Every prototype interaction works AND persists through real backend APIs / state management.
   - Loading, error, validation (`aria-invalid="true"`), disabled (`aria-describedby`), and empty states match the prototype's visual language.

---

## 5. Phase 5 — Recursive Skill Improvement Protocol

This skill is designed to evolve empirically during real replication runs:

1. **Detect**: During porting or visual/functional verification, record every concrete mismatch, CSS specificity conflict, framework quirk, or edge case encountered.
2. **Fix Code**: Resolve the defect in the production implementation and re-verify.
3. **Generalize & Update Skill**: Distill the root cause into a framework-neutral or adapter-specific rule and append it to the **Empirical Pitfalls & Lessons Learned** section below (and/or `references/framework-adapters.md`).

---

## 6. Empirical Pitfalls & Lessons Learned (Recursive Log)

- **[L-001] Generic Design Skills Overriding Prototype Contracts**: Loading a general "anti-slop / zero-pill" frontend design skill during prototype porting causes models to strip `.count` red pills, status dots, left accent bars (`#fd8c73`), header nav icons, and native system fonts. *Rule*: Always invoke `prototype-to-production` precedence (Section 0) to disable conflicting generic bans whenever an explicit prototype exists.
- **[L-002] Utility-Class Approximation Drift**: Translating custom CSS variables (`--line: #d0d7de`, `--subtle: #f6f8fa`, `--s5: 24px`, `--side-w: 272px`) into approximate Tailwind classes (`border-neutral-200`, `p-5`, `w-[264px]`) compounds into noticeable visual drift. *Rule*: Freeze and import the prototype's exact `:root` tokens and semantic class primitives verbatim.
- **[L-003] Web Font Injection Breaking System-Font Prototypes**: Leaving `<link href="https://fonts.googleapis.com/...">` in `index.html` or overriding `html` font-family destroys GitHub/OS-native visual density and CJK alignment. *Rule*: Audit `index.html` and global CSS to ensure the prototype's exact `font-family` stack is active.
- **[L-004] Unlayered Element Resets Clobbering Cascade-Layered Utility Frameworks**: When coexisting with Tailwind CSS v4 (or UnoCSS), placing prototype bare element selectors (`body`, `h1..h4`, `p`, `a`, `button`) unlayered causes them to override `@layer utilities` in supplementary components. *Rule*: Wrap prototype bare element defaults inside `@layer base` (after the framework's base import), while keeping semantic prototype classes (`.top`, `.btn`, `.box`, `.seg`, `dialog.dlg`) outside `@layer base`.
- **[L-005] Utility Preflight Stripping UA Defaults on `<dialog>` and Lists**: Preflight `* { margin: 0 }` pins native `showModal()` `<dialog>` elements to the top-left corner, and `ul/ol { list-style: none }` removes bullets from prototype `.prose` articles. *Rule*: Explicitly declare `dialog.dlg { margin: auto; }` and `list-style-type: disc/decimal` on prototype prose lists.
- **[L-006] Hidden Font Leaks in Embedded Renderers (Mermaid / Charts / Canvas)**: Cleaning `index.html` and global CSS is not enough if visualization libraries (e.g. `mermaid.initialize({ fontFamily })`) still hardcode old web fonts. *Rule*: Search the entire `src/` tree for legacy font names and sync every embedded renderer to the prototype's canonical font stack.
- **[L-007] Reusable CSS Primitives Stretched to New Production Contexts**: Production forms often add `<textarea class="input">` (colliding with prototype single-line `.input { height: 32px }`), and compact `<td>` disclosures (`details.more`) inherit card-level `border-top` and wide padding. *Rule*: Add targeted contextual rules (`textarea.input { height: auto; }`, `.tbl details.more { border-top: 0; }`) without mutating the base prototype primitive.
- **[L-008] Orphan `dark:*` Utility Classes Triggering OS Dark-Mode Flash**: When porting a light-only prototype into a codebase that previously used class-based dark mode, removing `@custom-variant dark` causes Tailwind v4 to revert `dark:*` classes to `@media (prefers-color-scheme: dark)`. Any leftover `dark:bg-*` in auxiliary components will suddenly render dark blocks on dark-mode OS browsers. *Rule*: Grep the entire `src/` tree for `dark:` utility classes and strip or replace them with the prototype's canonical light tokens.
