# Editor Viewer Implementation

This document describes the technical architecture and implementation details of the code editor viewer in px0.

Instead of relying on heavy third-party code editor components (such as Monaco, CodeMirror, or Ace), px0 implements a bespoke, high-performance, read-only virtualized editor viewer. It is designed to achieve sub-millisecond query responses, 60fps scrolling, instant navigation across large files (100k+ lines), and a minimal DOM footprint.

---

## 1. High-Level Architecture Overview

The editor viewer is split into two primary subsystems:

1. **Go Backend ([`highlight.go`](file:///home/arpit/workspace/px0/px0/highlight.go), [`server.go`](file:///home/arpit/workspace/px0/px0/server.go))**:
   - Windowed Chroma syntax highlighting.
   - Dual-tier chunk generation (fast inexact viewport window + background full-file pass).
   - LRU caching of highlighted HTML fragments.
   - Compact CSS class tokenization (`.k`, `.s`, `.nf`, etc.).

2. **Frontend Engine ([`web/src/renderer.js`](file:///home/arpit/workspace/px0/px0/web/src/renderer.js), [`web/src/cursor.js`](file:///home/arpit/workspace/px0/px0/web/src/cursor.js), [`web/style.css`](file:///home/arpit/workspace/px0/px0/web/style.css))**:
   - DOM virtualization (~60 active DOM row elements).
   - Offscreen text metrics (`#measure`) for sub-pixel character calculations.
   - Decoupled overlay caret and custom selection persistence.
   - Non-destructive inline DOM decorations (find matches, occurrences, links) via `TreeWalker`.
   - Dynamic chunk fetching and background refinement swapping.

---

## 2. DOM Structure and Layout

The editor surface is defined in [`web/index.html`](file:///home/arpit/workspace/px0/px0/web/index.html) and styled in [`web/style.css`](file:///home/arpit/workspace/px0/px0/web/style.css):

```html
<div id="editor">
  <div id="viewport">
    <div id="sizer">
      <div id="rows"></div>
      <div id="caret" hidden></div>
    </div>
  </div>
  ...
</div>
```

### Element Roles:
- **`#viewport`**:
  - CSS: `position: absolute; inset: 0; overflow: auto; contain: strict; cursor: text;`
  - Handles the native scroll mechanics and mouse wheel events.
- **`#sizer`**:
  - Acts as the scroll spacer.
  - Its height is set by `layout()` to `totalLines * LH + padding` to configure native browser scrollbar dimensions accurately.
  - Its width adjusts based on whether word-wrap is enabled or according to `(maxCols + 4) * chW + gutter`.
- **`#rows`**:
  - CSS: `position: absolute; top: 0; left: 0; will-change: transform;`
  - Contains only the rendered DOM rows for the current viewport window.
  - Translated vertically using CSS `transform: translateY(first * LH + "px")` to stay aligned with the viewport without reflowing other elements.
- **`#caret`**:
  - Independent overlay cursor element residing directly under `#sizer` rather than inside the line rows.

---

## 3. Virtualization and Rendering Pipeline

### Row Recycling (`paint()`)
The frontend never instantiates DOM nodes for all file lines. Only the visible lines plus overscan rows are maintained in the DOM:

$$\text{first} = \max\left(0, \left\lfloor\frac{\text{scrollTop}}{\text{LH}}\right\rfloor - \text{OVERSCAN}\right)$$
$$\text{count} = \left\lceil\frac{\text{clientHeight}}{\text{LH}}\right\rceil + 2 \times \text{OVERSCAN} \quad (\text{OVERSCAN} = 24)$$
$$\text{last} = \min(\text{totalLines}, \text{first} + \text{count})$$

At typical desktop resolutions, this caps the active DOM row count at around **50–70 elements**, keeping frame budgets under 1ms.

### HTML Row Structure
Each line is rendered inside `#rows` with:
```html
<div class="row" data-l="123">
  <div class="g">123</div>
  <div class="c">...token markup...</div>
</div>
```
- `.g`: Sticky line gutter number (`position: sticky; left: 0; z-index: 2;`).
- `.c`: Code content container (`white-space: pre; tab-size: 4;`).

### Animation Frame Throttling
Scroll events attached to `#viewport` are debounced into `requestAnimationFrame`:
```javascript
let raf = 0;
export function render() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; paint(); });
}
```

---

## 4. Chunk Loading & Background Refinement

Files are loaded in chunks (`CHUNK = 500` lines) via `/api/file?path=...&start=...&count=...`:

1. **On-Demand Streaming (`ensureChunks`)**:
   - As the user scrolls, `ensureChunks(d, first, last)` identifies which 500-line blocks intersect `[first, last]`.
   - Missing chunks trigger asynchronous API fetches.
2. **Windowed Backend Highlighting**:
   - In [`highlight.go`](file:///home/arpit/workspace/px0/px0/highlight.go), Chroma lexes bounded slices (`hlChunk = 1000` lines) padded with `hlContext = 400` context lines.
   - If a multi-line token (comment or raw string) spans beyond the context window, the chunk is flagged as `refine: true` / inexact.
3. **Chunk Refinement (`refineChunk`)**:
   - The frontend accepts inexact chunks immediately to prevent scroll stutter.
   - A background thread in the Go backend finishes full-file tokenization.
   - `refineChunk()` polls and swaps in corrected highlighted lines once the exact pass finishes, triggering a targeted re-render.

---

## 5. Selection Preservation & Overlay Caret

### Selection Preservation Across Repaints
Since `rowsEl.innerHTML` is regenerated during scrolling or state changes (e.g., search highlighting or link activation), browser selections would normally be dropped:
- `saveSelection()` maps the active `window.getSelection()` range into file-level `{ line, col }` coordinates.
- After DOM replacement, `restoreSelection()` uses a `TreeWalker` to find matching text offsets in the new DOM rows and invokes `window.getSelection().setBaseAndExtent(...)`.

### Decoupled Overlay Caret (`placeCaret()`)
- The caret is not placed inside `.c` or `.row`.
- Instead, `placeCaret()` measures a collapsed DOM Range at `{ line, col }` using `toPoint()` and translates `#caret` using `transform: translate(x, y)`.
- Benefits:
  - Text nodes inside code rows remain untouched by caret insertion or removal.
  - Native browser copy/drag selections remain clean.
  - Drag-selection does not fight with caret repaints.

---

## 6. Non-Destructive Inline Decorations

Search match markers (`<mark>`), symbol occurrence markers (`.occ`), and definition links (`.link`) are added dynamically via `decorate()`:
- Applied exclusively to the ~60 mounted rows.
- Uses `TreeWalker` to walk only `NodeFilter.SHOW_TEXT` nodes within each row's `.c` container.
- Splits matching text nodes and wraps them in spans or marks without modifying or breaking surrounding syntax highlighting tags.
