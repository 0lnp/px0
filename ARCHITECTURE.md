# Architecture and Performance Optimizations of px0

This document outlines the high-level architecture and key performance optimizations implemented in **px0**, explaining how it delivers instant navigation, sub-millisecond queries, and a minimal memory footprint across codebases spanning tens of thousands of files.

---

## 1. High-Level Architecture

px0 is structured as an ultra-lightweight, zero-config, read-only code reader and navigator packaged as a single statically linked binary (~9.5 MB).

```mermaid
flowchart TD
    subgraph Browser ["Web Frontend (Vanilla JS + CSS, Virtualized)"]
        UI["UI & Virtual DOM (~60 rows live)"]
        FuzzStore["Fuzzy & Tree Cache"]
        Canvas["Offscreen Canvas Fast Tokenizer"]
    end

    subgraph GoServer ["px0 Go Backend (HTTP / JSON / Gzip)"]
        Server["HTTP Router & Middleware"]
        MemScavenge["Memory Scavenger (FreeOSMemory after 15s)"]
        IndexEngine["In-Memory Index (Paths & Tree Nodes)"]
        SearchEngine["Search Engine (Parallel Worker Pool)"]
        HLEngine["Syntax Highlighter (Chroma + Windowing + LRU Cache)"]
        LSPMgr["LSP Manager (Lazy-spawned Language Servers)"]
    end

    subgraph FS ["Host Filesystem"]
        Files["Source Files / .gitignore"]
    end

    Browser <-->|HTTP / JSON (Gzip)| Server
    Server --> IndexEngine
    Server --> SearchEngine
    Server --> HLEngine
    Server --> LSPMgr
    IndexEngine --> FS
    SearchEngine --> FS
    HLEngine --> FS
    LSPMgr --> FS
```

### Core Components
1. **Single Binary Distribution (`main.go`):** Embeds the web UI (HTML, CSS, JS ~74 KB) via `go:embed`. Runs with no runtime dependencies, no CGO, no node_modules.
2. **In-Memory Path Index (`index.go`):** Collects and maintains file paths, directory trees, and basenames in compact structures for instant path resolution and fuzzy lookups.
3. **Optimized Ignore Engine (`ignore.go`):** Fast multi-level `.gitignore` evaluator using classification-based matching without regex backtracking where possible.
4. **Windowed Syntax Highlighting Engine (`highlight.go`):** Slotted file reader and Chroma tokenizer that works on viewport windows rather than entire multi-megabyte files.
5. **Parallel Search Engine (`search.go`):** Multi-core worker pool utilizing custom buffer reuse, SIMD/Boyer-Moore-backed literal search, and line-level fast elision.
6. **Lazy LSP Manager (`lsp.go`, `lspnav.go`, `lspservers.go`):** Dynamic lifecycle controller that spawns language servers only upon first request for that language, automatically falling back to regex definitions when LSP is inactive.
7. **DOM Virtualization Frontend (`web/app.js`):** Custom ~60-row DOM virtualization with offscreen canvas text measuring and `requestAnimationFrame` render throttling.

---

## 2. Key Performance Optimizations

### A. Indexing & Filesystem Walking (`index.go`, `ignore.go`)

* **Bounded Parallel Directory Walk:**
  * Uses a channel-based semaphore (`runtime.NumCPU() * 4`) to bound goroutines during tree walking.
  * When the worker pool saturates, recursive walking falls back to inline execution on the caller goroutine to prevent memory inflation and scheduler overhead.
* **Symlink Cycle Immunity:**
  * Rejects directory symlinks entirely (`e.Type()&os.ModeSymlink != 0`) to eliminate infinite recursive loop risks and stat penalties.
* **Rule Specialization in Ignore Engine (`ruleKind`):**
  * Rather than evaluating complex regexes for every path, rules are classified into fast branches:
    * `rkSegEq`: Direct string comparison against each path segment (e.g., `node_modules`).
    * `rkSegSuffix`: Direct suffix check (e.g., `*.pyc`).
    * `rkPathEq`: Exact anchored path prefix matches.
  * For rules that genuinely need regex, a literal `prefix` test and a substring `must` check are applied *before* invoking Go's backtracking regex engine, filtering out ~99% of paths without regex overhead.
* **Precomputed Lowercase & Basename Offsets:**
  * `FileEntry` precomputes `lower` and `nameStart` on insertion. Fuzzy searches run directly against pre-allocated lowercase slices without runtime allocations.
* **Non-Blocking Asynchronous Startup Pipeline:**
  * The HTTP listener binds and starts serving traffic immediately (<1ms) rather than waiting for directory walking or language server discovery.
  * The root directory tree (`dir=""`) is extracted and made available to `/api/tree` in sub-millisecond time, allowing the browser sidebar to render immediately.
  * Full tree walking and indexing run concurrently in a background goroutine. If the user clicks a directory before it has been reached by the walker, `/api/tree` polls briefly (up to 300ms) to resolve it smoothly.
  * Browser launch (`openBrowser`) executes immediately in parallel without artificial sleep delays.
  * Language server discovery (`exec.LookPath`) executes concurrently in the background so binary detection never delays port binding or HTTP serving.

---

### B. Viewport-Based Windowed Highlighting (`highlight.go`)

* **Chunk + Context Highlighting (No Full Tokenization):**
  * Chroma’s lexers run under 1 MB/s; tokenizing a 100,000-line file upfront would introduce multi-second stalls.
  * px0 lexes in bounded windows (`hlChunk = 1000` lines) padded with throwaway context (`hlContext = 400` lines). The leading context puts the lexer in the proper lexical state (e.g., inside block comments or raw strings); trailing context ensures tokens are properly terminated.
* **Byte-Capped Windows (`hlWindowBytes = 512 KB`):**
  * In files with very long lines (e.g., minified JS/JSON), 1,000 lines could equal tens of megabytes. If the window byte cap is exceeded, context is dropped, preventing lexer stalls.
* **Dual-Tier Processing with Background Exact Pass:**
  * For files under `bgLimit = 2 MB`, after serving the initial viewport chunk instantly, a background goroutine finishes exact tokenization and transitions subsequent chunks to instant map lookups.
* **LRU Highlight Memory Budget (`cacheBudget = 512 MB`):**
  * Highlight caches track the byte size of generated HTML strings and evict using an LRU linked list (`container/list`) when reaching the 512 MB threshold.
* **Short Class Token Mapping:**
  * Token types are mapped to tiny 1-to-2 character CSS classes (`c` for comment, `k` for keyword, `s` for string, etc.), drastically shrinking payload sizes over the wire.

---

### C. Search Engine (`search.go`)

* **Whole-File Reject Fast Path:**
  * Searches perform an initial `bytes.Contains(data, literal)` check across the entire file before doing any newline splitting, regex processing, or line-by-line scanning.
* **Worker Buffer Reuse (`sync.Pool` & `workBuf`):**
  * File reads do not allocate per file. Each worker in the search pool holds a reusable `workBuf` containing:
    * Reusable read buffer (`readInto`) that grows only when encountering a larger file.
    * In-place ASCII lowercase buffer (`asciiLower`) to avoid UTF-8 fold allocations during case-insensitive literal searches.
* **Smart Snippet Elision (`snip lead/keep/max`):**
  * Snippets truncate leading whitespace and elide text further than 32 runes away (`snipLead`), reporting compact `pre`, `mid`, and `post` slices directly to the client. This avoids client-side UTF-16 vs byte index reconciliation.
* **Early Terminating Def Scanner:**
  * Pre-compiled regex patterns identify definition patterns per file extension concurrently during normal search passes, returning definition flags (`Match.Def`) without separate passes.

---

### D. Fuzzy Matching (`fuzzy.go`)

* **Two-Pass Bounded Search:**
  * **Pass 1 (Forward):** Quickly confirms all query runes exist in order and marks the end boundary index.
  * **Pass 2 (Backward):** Scans backward from the end boundary to find the tightest possible cluster of matches. This matches the ranking accuracy of dynamic programming algorithms ($O(N \times M)$) while maintaining an $O(N)$ linear scan time.
* **Weighted Scoring Matrix:**
  * Awards heavy bonuses for consecutive characters (+12), word/boundary beginnings (`/`, `_`, `-`, `.`) (+16), camelCase transitions (+14), and hits inside the file basename (+14), while penalizing non-consecutive gaps.
* **Parallel Chunk Slicing:**
  * For indices with over 4,000 files, queries are partitioned across CPU cores using a worker pool, followed by merging the top results via an in-place sort.

---

### E. Memory Management & Scavenging (`server.go`)

* **Proactive OS Memory Release (`debug.FreeOSMemory()`):**
  * A background goroutine (`scavenge`) monitors server request activity (`s.lastReq`).
  * If the server remains idle for more than 15 seconds after a heavy operation (such as indexing or full-tree search), it triggers `debug.FreeOSMemory()`, returning unused memory pages from the Go runtime back to the host operating system.
* **Gzip Buffer Pooling:**
  * `gzip.Writer` instances are pooled via `sync.Pool` with `gzip.BestSpeed` compression level, reducing memory allocations on repetitive JSON responses.

---

### F. Frontend DOM Virtualization (`web/app.js`)

* **Fixed DOM Row Footprint (~60 Elements):**
  * The browser never instantiates DOM elements for thousands of lines. Only the visible viewport + overscan (`OVERSCAN = 24` rows) are mounted in the DOM.
  * Scrolling updates a single CSS `transform: translateY(...)` container, recycling rows dynamically.
* **Offscreen Font Measurement:**
  * Uses an offscreen element (`#measure`) to calculate character widths (`S.chW`) down to fractional sub-pixels, ensuring scrollbar thumb dimensions and gutter widths are accurate without querying layout geometry on every paint.
* **Throttling via `requestAnimationFrame`:**
  * Scroll events schedule paint operations strictly inside `requestAnimationFrame`, preventing scroll hitching and duplicate layout reflows.
* **Localized DOM Decorations:**
  * Match highlights, bracket markers, and occurrences are applied only to the ~60 active rows, ensuring regex highlighting stays well within a sub-millisecond frame budget.

---

### G. Typography, Reading Themes & Universal Search (`web/style.css`, `web/app.js`)

* **Optimized Monospace Typography Stack:**
  * Uses `"JetBrains Mono", "Fira Code", "Cascadia Code", "SF Mono"` with OpenType code features (`calt` ligatures, `zero` slashed/dotted zero, `cv02`, `cv08`, `ss01`).
  * Explicit font smoothing (`-webkit-font-smoothing: antialiased`, `-moz-osx-font-smoothing: grayscale`) and `text-rendering: optimizeLegibility` across all platforms.
* **Tokyo Night Reading Theme:**
  * Dark mode incorporates Tokyo Night-inspired palettes (`#1a1b26` background, `#c0caf5` foreground, `#7aa2f7` accents) calibrated to minimize optical fatigue and offer high syntax distinction for prolonged reading sessions.
* **Universal Fast Search (`Cmd+K` / `Ctrl+K`):**
  * Instant access palette unified with standard developer shortcuts (`Cmd/Ctrl+K` quick open, `Cmd/Ctrl+P` file find, `Cmd/Ctrl+Shift+P` command palette, `Cmd/Ctrl+Shift+F` full text search).
  * Prefix dispatch (`>` command, `@` symbol, `:` line) allows fluid, keyboard-driven navigation across any project.

---

### H. Lazy LSP Architecture & Lifecycle (`lspservers.go`, `lsp.go`, `lspnav.go`)

* **Zero-Cost Background Discovery:**
  * At startup, the LSP manager does not spawn language server processes. It scans `$PATH` concurrently via `exec.LookPath` to determine which registered language server binaries exist on the host. This ensures instantaneous startup times and zero idle memory overhead.
* **Ordered Precedence by Extension:**
  * Supported language servers are defined in an ordered registry (`lspRegistry`). For any given file extension, the first matching binary found on `$PATH` takes ownership (e.g. for Python, `pyright` takes precedence over `pylsp`, which takes precedence over `ruff`).
* **On-Demand Lazy Spawning:**
  * Server processes are spawned strictly on the first LSP request (hover, definition, references, document symbol) targeting a file handled by that server. If a developer only browses Go files, Rust or Python servers are never invoked.
  * Subsequent requests reuse the running client, serialized through thread-safe channels with initialization timeouts (30s) to absorb heavy server startup handshakes.
* **External Path Boundary Control:**
  * When a language server points to files outside the indexed workspace (such as standard library or module cache dependencies), the LSP manager selectively admits these paths into an external allowlist (`Allowed()`). This enables jumping to third-party definitions while strictly preventing arbitrary filesystem traversals.
* **Graceful Degradation & Regex Fallback:**
  * If no LSP server binary is found on `$PATH`, or if an LSP server process crashes or times out during initialization, the UI seamlessly falls back to fast heuristic regex indexing and symbol lookup without blocking the user.

