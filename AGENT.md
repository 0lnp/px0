# Operational Guidelines for AI Agents

This document defines critical instructions, architectural principles, and documentation maintenance workflows for AI agents working on px0.

## Core Architectural Tenets

1. Read-Only by Design: px0 is exclusively a code navigation and exploration tool. It does not write, edit, format, or mutate project files on disk. Do not introduce file modification or editor save APIs.
2. Zero Runtime and Single Binary Footprint: Any change must compile into a single static binary (`go:embed` for web assets). Do not introduce runtime dependencies (no Node.js/npm runtime requirement, no external database, no CGO dependencies).
3. Stateless on Disk: px0 leaves zero configuration or temporary cache artifacts on the user filesystem (no local `.px0/` folders or cache files). Keep working trees untouched.
4. Performance Budgets: Indexing must complete in milliseconds using bounded concurrency (`NumCPU * 4`). File open must remain $O(1)$ relative to file length using windowed chunking (`hlChunk = 1000`) and browser DOM virtualization. Maintain explicit memory reclamation (`debug.FreeOSMemory()` on idle).

## Mandatory Documentation Maintenance Protocol

Whenever modifying, adding, or refactoring code in this repository, you must audit and update the documentation accordingly:

### Documentation Mapping Matrix

| Component Modified | Primary Source Files | Docs to Update |
| ------------------ | -------------------- | -------------- |
| System Architecture / Optimizations | All `.go` files, `web/app.js` | `ARCHITECTURE.md` |
| Indexing / Tree Walk / Gitignore | `index.go`, `ignore.go` | `ARCHITECTURE.md`, `README.md` |
| Search / Regex / Fuzzy Finder | `search.go`, `fuzzy.go` | `ARCHITECTURE.md`, `BENCHMARKS.md` |
| Syntax Highlighting & Lexing | `highlight.go` | `ARCHITECTURE.md`, `README.md` |
| Language Servers (LSP) | `lsp.go`, `lspnav.go`, `lspservers.go` | `README.md`, `BENCHMARKS.md` |
| Frontend UI / Virtualization | `web/app.js`, `web/index.html`, `web/style.css` | `ARCHITECTURE.md`, `README.md` |
| CLI Flags / Configuration | `main.go` | `README.md` |
| Performance Metrics / Scripts | `benchmark.sh` | `BENCHMARKS.md` |

## Checklist for Agents Prior to Submitting Work

- Verification: Ran `go test ./...` and confirmed all unit/regression tests pass (`ok px0`).
- Build Integrity: Verified successful build with `go build -o px0 .`.
- Architecture Sync: Any new optimization, algorithmic adjustment, or structural change is documented in `ARCHITECTURE.md`.
- Flag & Shortcut Sync: Any new keyboard shortcut, UI behavior, or CLI flag is reflected in `README.md`.
- Benchmark Alignment: If search, highlight, or index performance characteristics change, verify whether `BENCHMARKS.md` requires updated notes or numbers.

## Frontend Architecture & Code Map for Agents

To quickly locate and modify UI features, refer to this structured section index of `web/index.html` and `web/app.js`:

### HTML Structure

| Section / Element ID | Description |
| -------------------- | ----------- |
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

### Frontend Modules & Build Workflow

The frontend is modularized into clean ES modules under `web/src/` and bundled into `web/app.js` using `scripts/build-web.js`:

- Build Script: Run `./scripts/build-web.js` (or `bun scripts/build-web.js` / `node scripts/build-web.js`). It automatically builds and validates `web/app.js`.
- Release Integration: `build.sh` automatically runs `./scripts/build-web.js` before cross-compiling Go release binaries.
- Module Layout:

| Module | Primary Responsibilities & Key Exports |
| ------ | -------------------------------------- |
| `web/src/state.js` | Core state object `S`, `doc_()`, `api()`, `esc()`, `$`, `$$`, constants (`LH`, `CHUNK`, `OVERSCAN`, `MOD`) |
| `web/src/ui.js` | DOM references (`vp`, `sizer`, `rowsEl`, `editor`, `refmenu`, `toastEl`), `showToast()`, `copyToClipboard()` |
| `web/src/renderer.js` | `measure()`, `layout()`, `render()`, `paint()`, `toggleWordWrap()`, `toggleLineNumbers()`, on-demand chunk fetching |
| `web/src/tabs.js` | `openFile()`, `closeTab()`, `switchTab()`, `drawTabs()`, `drawCrumbs()`, `showImage()` |
| `web/src/history.js` | `pushHistory()`, `go()`: jump history back/forward (Alt+Left, Alt+Right) |
| `web/src/status.js` | `updateStatus()`, `initMetrics()`, `updateMetricsDisplay()`, `setStatusNote()`, `fmtBytes()`, `setLspState()`, `drawLspStatus()` |
| `web/src/cursor.js` | `wordAtPoint()`, `moveCursor()`, click / double-click selection, occurrence highlight |
| `web/src/hover.js` | `onMove()`, `hoverAt()`, `showHover()`, `hideHover()`, token link modifier handling |
| `web/src/refmenu.js` | Context menu pill for selections (`Copy Ref`, `Copy for Claude`, `Find Usages`) |
| `web/src/lsp.js` | `gotoDefinition()`, `findReferences()`, `warmLSP()`, `lspCall()`, hit formatting |
| `web/src/tree.js` | `drawTree()`, `fileKind()`, `revealDir()`, `revealFile()`, explorer tree click handlers |
| `web/src/search.js` | `runSearch()`, `renderResults()`, `displayPath()`, workspace search panel |
| `web/src/outline.js` | `loadOutline()`, `upgradeOutline()`, `drawOutline()`, symbol kind badges |
| `web/src/panels.js` | `showPanel()`, sidebar switching, reindex trigger, draggable sidebar resizer |
| `web/src/inspector.js` | `showRightInspector()`, `setRightInspectorTab()`, `inspectReferences()`, right resizer |
| `web/src/find.js` | `openFind()`, `clearFind()`, `runFind()`, `jumpToHit()`, minimap hit dots (Ctrl+F) |
| `web/src/palette.js` | `openPalette()`, `refreshPalette()`, `COMMANDS`, fuzzy file/symbol/command finder |
| `web/src/shortcuts.js` | `toggleTheme()`, `showHelp()`, Alt+Z word wrap toggle, keyboard shortcuts listener |
| `web/src/main.js` | Module initializations and application `boot()` sequence |
