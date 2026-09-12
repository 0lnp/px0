# AGENT.md: Operational Guidelines for AI Agents

This document defines critical instructions, architectural principles, and documentation maintenance workflows for AI agents working on **px0**.

---

## 1. Core Architectural Tenets (DO NOT VIOLATE)

1. **Read-Only by Design:**
   * px0 is exclusively a code navigation and exploration tool. It does not write, edit, format, or mutate project files on disk. Do not introduce file modification or editor save APIs.
2. **Zero Runtime & Single Binary Footprint:**
   * Any change must compile into a single static binary (`go:embed` for web assets).
   * Do not introduce runtime dependencies (no Node.js/npm runtime requirement, no external database, no CGO dependencies).
3. **Stateless on Disk:**
   * px0 leaves zero configuration or temporary cache artifacts on the user's filesystem (no local `.px0/` folders or cache files). Keep working trees untouched.
4. **Performance Budgets:**
   * **Indexing:** Must complete in milliseconds using bounded concurrency (`NumCPU * 4`).
   * **File Open:** Must remain $O(1)$ relative to file length using windowed chunking (`hlChunk = 1000`) and browser DOM virtualization.
   * **Memory Scavenging:** Maintain explicit memory reclamation (`debug.FreeOSMemory()` on idle).

---

## 2. Mandatory Documentation Maintenance Protocol

Whenever modifying, adding, or refactoring code in this repository, you **MUST** audit and update the documentation accordingly:

### Documentation Mapping Matrix

| Component Modified | Primary Source Files | Docs to Update |
| :--- | :--- | :--- |
| **System Architecture / Optimizations** | All `.go` files, `web/app.js` | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| **Indexing / Tree Walk / Gitignore** | [`index.go`](index.go), [`ignore.go`](ignore.go) | [`ARCHITECTURE.md`](ARCHITECTURE.md), [`README.md`](README.md) |
| **Search / Regex / Fuzzy Finder** | [`search.go`](search.go), [`fuzzy.go`](fuzzy.go) | [`ARCHITECTURE.md`](ARCHITECTURE.md), [`BENCHMARKS.md`](BENCHMARKS.md) |
| **Syntax Highlighting & Lexing** | [`highlight.go`](highlight.go) | [`ARCHITECTURE.md`](ARCHITECTURE.md), [`README.md`](README.md) |
| **Language Servers (LSP)** | [`lsp.go`](lsp.go), [`lspnav.go`](lspnav.go), [`lspservers.go`](lspservers.go) | [`README.md`](README.md), [`BENCHMARKS.md`](BENCHMARKS.md) |
| **Frontend UI / Virtualization** | [`web/app.js`](web/app.js), [`web/index.html`](web/index.html), [`web/style.css`](web/style.css) | [`ARCHITECTURE.md`](ARCHITECTURE.md), [`README.md`](README.md) |
| **CLI Flags / Configuration** | [`main.go`](main.go) | [`README.md`](README.md) |
| **Performance Metrics / Scripts** | [`benchmark.sh`](benchmark.sh) | [`BENCHMARKS.md`](BENCHMARKS.md) |

---

## 3. Checklist for Agents Prior to Submitting Work

- [ ] **Verification:** Ran `go test ./...` and confirmed all unit/regression tests pass (`ok px0`).
- [ ] **Build Integrity:** Verified successful build with `go build -o px0 .`.
- [ ] **Architecture Sync:** Any new optimization, algorithmic adjustment, or structural change is documented in [`ARCHITECTURE.md`](ARCHITECTURE.md).
- [ ] **Flag & Shortcut Sync:** Any new keyboard shortcut, UI behavior, or CLI flag is reflected in [`README.md`](README.md).
- [ ] **Benchmark Alignment:** If search, highlight, or index performance characteristics change, verify whether [`BENCHMARKS.md`](BENCHMARKS.md) requires updated notes or numbers.

---

## 4. Frontend Architecture & Code Map for Agents

To quickly locate and modify UI features, refer to this structured section index of `web/index.html` and `web/app.js`:

### HTML Structure (`web/index.html`)

| Section / Element ID | Description |
| :--- | :--- |
| `<nav id="rail">` | Left activity rail (switch between Explorer, Search, Outline, Theme, Shortcuts) |
| `<aside id="side">` | Collapsible sidebar containing panels: `#panel-files` (tree), `#panel-search`, `#panel-outline` |
| `<div id="resizer">` | Draggable splitter between sidebar and main editor viewport |
| `<div id="tabs">` & `#crumbs` | Open file tabs bar and current file path breadcrumb navigation |
| `<div id="editor">` | Core editor container with `#viewport`, `#sizer`, and virtual rows container `#rows` |
| `<div id="empty">` | Welcome / splash screen shown when no files are open |
| `<div id="hovercard">` | Floating LSP type signature, doc preview, and quick AI reference buttons |
| `<div id="refmenu">` | Context action pill shown when text or lines are selected (Copy Ref, Copy for Claude, Usages) |
| `<div id="findbar">` | In-file search overlay (Ctrl+F) |
| `<div id="toast">` | Floating bottom notification toast confirming clipboard copy actions |
| `<footer id="status">` | Bottom status bar: language, lines, size, cursor pos, LSP status, and index time |
| `<div id="overlay">` | Modal overlay hosting Quick Open and Command Palette (`#palette`) |
| `<div id="helpsheet">` | Keyboard shortcuts cheat-sheet modal overlay |

### JavaScript Sections (`web/app.js`)

All logic in `web/app.js` is structured into labeled sections:

| Section # | Section Header | Primary Functions & Responsibilities |
| :---: | :--- | :--- |
| **1** | `VIRTUAL RENDERER & DOM RECYCLER` | `measure()`, `layout()`, `render()`, `renderRow()`, `fetchChunk()`: 60 FPS scrolling and on-demand chunk fetching |
| **2** | `TABS & FILE OPENING LIFECYCLE` | `openFile()`, `createTab()`, `closeTab()`, `activateTab()`: tab state and URL hash syncing |
| **3** | `NAVIGATION HISTORY` | `pushJump()`, `jumpBack()`, `jumpForward()`: cursor position history with Alt+Left / Alt+Right |
| **4** | `STATUS BAR & NOTIFICATIONS` | `updateStatus()`, `setStatusNote()`, `setLspState()`: bottom bar indicators |
| **5** | `CODE VIEWPORT & CURSOR` | Viewport click handlers, cursor positioning, word under cursor, occurrence highlighting |
| **6** | `HOVERCARD & LSP TOOLTIPS` | `onMove()`, `hoverAt()`, `showHover()`, `hideHover()`: debounced hovercard with action buttons |
| **7** | `SELECTION REFERENCE MENU (#refmenu)` | `updateSelectionMenu()`, `hideRefMenu()`, `getSelectedRangeInfo()`: Copy Ref & Claude prompt formatting |
| **8** | `DEFINITIONS & REFERENCES` | `gotoDefinition()`, `findReferences()`, `showHits()`: LSP definition & references with regex fallback |
| **9** | `FILE TREE` | `drawTree()`, `toggleNode()`: recursive directory explorer with lazy node loading |
| **10** | `WORKSPACE SEARCH PANEL` | `runSearch()`: full-text regex and case-sensitive workspace search with match groups |
| **11** | `SYMBOL OUTLINE` | `loadOutline()`: document symbol outline extraction via LSP |
| **12** | `PANELS & RESIZER` | `showPanel()`, splitter dragging logic |
| **13** | `FIND IN CURRENT FILE` | `openFind()`, `stepFind()`: Ctrl+F find bar in current file |
| **14** | `COMMAND PALETTE` | `openPalette()`, `filterPalette()`: fuzzy file, symbol, and command search |
| **15** | `THEME & HELP` | `toggleTheme()`, `showHelp()`: light/dark theme toggle and help overlay |
| **16** | `GLOBAL KEYBOARD SHORTCUTS` | `addEventListener('keydown')`: central keyboard shortcut dispatching |
| **17** | `BOOTSTRAP / INITIALIZATION` | `boot()`: initialization sequence, font measurement, and background index polling |

