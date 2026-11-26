# Framework Adapters: Prototype-to-Production Translation Patterns

This reference shows how to port a single canonical HTML/CSS/JS prototype (with `:root` tokens, semantic CSS classes, and `aria-*` state hooks) faithfully into any target production frontend stack without visual drift.

---

## 1. Shared Foundation Across All Stacks

Before writing framework components, keep a single canonical stylesheet (e.g., `prototype-system.css`) containing:
1. `@layer od-layout` (or equivalent structural primitives).
2. Exact `:root` CSS variables from the prototype.
3. Exact semantic classes (`.top`, `.brand`, `.nav`, `.side`, `.box`, `.btn`, `.seg`, `.sw`, `.tip`, `.tbl`, `details.more`, `dialog.dlg`, `.toast`) and `@media` responsive rules.
4. An icon map containing the prototype's exact SVG paths (preserving `viewBox`, `stroke-width`, and `--od-icon-size`).

---

## 2. React (Vite / Next.js) Adapter

### CSS Coexistence with Tailwind v4
If the project uses `@import "tailwindcss";`, Tailwind's `@layer base` preflight resets `h1..h4`, `button`, `dialog`, `ul`, `p`, and margins.
- Keep prototype component classes unlayered (or in a higher-priority layer after Tailwind's `@layer base`) so `.btn`, `.page-h h1`, `.box-h`, `dialog.dlg`, and `.prose ul` never lose their prototype geometry.
- **Native `<dialog>` centering**: Tailwind preflight sets `margin: 0` on `dialog` (or `*`), which breaks browser default `dialog { margin: auto }` centering! Explicitly set `dialog.dlg { margin: auto; }` in the canonical stylesheet.

### Component Patterns
- **Segmented Control (`.seg`)**:
  ```tsx
  <div className="seg" role="group" aria-label={label}>
    {items.map(([val, text]) => (
      <button
        key={val}
        type="button"
        aria-pressed={value === val}
        onClick={() => onChange(val)}
      >
        {text}
      </button>
    ))}
  </div>
  ```
- **Switch (`.sw`)**:
  ```tsx
  <button
    type="button"
    className="sw"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={onToggle}
  >
    <span className="track" />
    <span>{checked ? '开' : '关'}</span>
  </button>
  ```
- **Native `<dialog className="dlg">`**:
  Use `useRef<HTMLDialogElement>(null)` with `useEffect` calling `el.showModal()` when `open` transitions `false -> true` and `el.close()` when `true -> false`. Listen to native `onCancel` (`e.preventDefault(); onClose();`) and save/restore `document.activeElement` for keyboard focus fidelity.
- **IME Composition on Search Inputs**:
  React controlled `<input value={query} onChange={...} />` handles CJK IME cleanly without DOM replacement; avoid remounting the input key while typing.

---

## 3. Vue 3 (`<script setup>` / Nuxt) Adapter

- Import `prototype-system.css` once in `src/main.ts`.
- Keep global layout & semantic classes unscoped so `:root` tokens and `.od-*` primitives apply uniformly; use `<style scoped>` only for production-only extensions.
- Bind ARIA hooks directly with Vue directives:
  ```html
  <div class="seg" role="group" :aria-label="label">
    <button
      v-for="[val, text] in items"
      :key="val"
      type="button"
      :aria-pressed="modelValue === val ? 'true' : 'false'"
      @click="$emit('update:modelValue', val)"
    >
      {{ text }}
    </button>
  </div>
  ```
- Note on boolean ARIA attributes in Vue/HTML: Vue renders `:aria-pressed="true"` as `aria-pressed="true"` and `:aria-pressed="false"` as `aria-pressed="false"` (ensure string `'true'`/`'false'` if strict CSS selector `[aria-pressed="true"]` is used).
- Replace imperative DOM dialogs with `<dialog ref="dlgRef" class="dlg" @cancel.prevent="close">` + `watch(open, ...)` calling `showModal()`/`close()`.
- Wire prototype state to Pinia or `reactive()` composables backed by `fetch` / `EventSource`.

---

## 4. Vanilla JS / Web Components (Zero-Framework or Vite ES Modules)

- Keep `assets/app.css` verbatim as the production stylesheet.
- Split monolithic `app.js` into clean ES modules:
  - `store.js`: pub-sub reactive store syncing with `/api/*` and SSE (`EventSource`).
  - `icons.js` & `primitives.js`: pure template helpers (`box()`, `seg()`, `sw()`, `tip()`, `btn()`, `more()`).
  - `views/*.js`: one view module per prototype screen.
  - `dialog.js` & `toast.js`: native `<dialog>` controller + live toast manager.
- Preserve focus restoration (`data-k` focus key or `requestAnimationFrame` focus restore) and `compositionend` / `!e.isComposing` guard for CJK IME inputs when doing subtree DOM updates.
- Alternatively, wrap complex domain widgets in Light-DOM Custom Elements (`class SegControl extends HTMLElement`) so prototype CSS rules cascade directly without Shadow DOM duplication.

---

## 5. Svelte 5 & Angular Adapters (Quick Reference)

| Concern | Svelte 5 | Angular (Standalone) |
| :--- | :--- | :--- |
| Global tokens & classes | Import `prototype-system.css` in `+layout.svelte` / `main.ts` | Register `prototype-system.css` in `angular.json` `styles` |
| Reactive state | `$state()` / `$derived()` in `.svelte.ts` store | `signal()` / `computed()` in injectable service |
| ARIA CSS hooks | `aria-pressed={current === val}` | `[attr.aria-pressed]="current() === val ? 'true' : 'false'"` |
| Native `<dialog>` | `bind:this={dlg}` + `$effect(() => open ? dlg.showModal() : dlg.close())` | `@ViewChild('dlg')` + `effect()` |
| Event delegation replacement | `onclick={() => handler(id)}` | `(click)="handler(id)"` |

---

## 6. Adapter-Specific Pitfalls Log

- **[A-001] Tailwind v4 Preflight Breaks Native `<dialog>` Centering & Margins**: Tailwind's `* { margin: 0 }` overrides UA stylesheet `dialog { margin: auto }`, causing `showModal()` dialogs to pin to the top-left corner of the viewport. *Fix*: Always declare `dialog.dlg { margin: auto; }` explicitly.
- **[A-002] CSS `aria-*` Selector Strictness**: CSS rules like `.nav button[aria-current="page"]` or `.seg button[aria-pressed="true"]` require exact string attribute values. In React/Vue/Angular, always pass `'true'` / `'false'` (or `'page'` / `undefined`) explicitly and verify DOM output matches the prototype selector.
- **[A-003] `<button>` Border & Background Reset Collision**: Tailwind resets `button { background-color: transparent; }` inside `@layer base`. Because unlayered CSS beats `@layer base`, placing prototype `.btn`, `.btn.pri`, `.seg button` outside `@layer base` (or after Tailwind) guarantees exact button fill, height, border, and shadow parity.
- **[A-004] Bare Element Selectors vs. `@layer utilities`**: Always place prototype bare element rules (`body`, `h1..h4`, `p`, `a`, `button`) inside `@layer base` after `@import "tailwindcss";` so they win over Tailwind Preflight without overriding `@layer utilities` (`mt-*`, `text-*`, `p-*`) in auxiliary widgets.
- **[A-005] Embedded Diagram & Chart Font Sync**: Sync third-party canvas/SVG renderers (`mermaid.initialize`, ECharts, Chart.js) to the exact prototype `--f` stack so diagrams blend seamlessly with the replicated shell.
