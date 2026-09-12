# px0: The Fastest Code Viewer for the Age of AI-Driven Development

> The modern IDE has reduced to just being a code viewer. In the era of autonomous AI agents, coding assistants, and automated code generation, humans spend far less time typing syntax into bloated editors and far more time reviewing, inspecting, understanding, and navigating code written by AI.
>
> px0 is built for this reality: a lightning-fast, zero-bloat, read-only code viewer. One single 9 MB binary. Zero runtime dependencies. Starts in < 1 ms and uses under 20 MB of RAM.

## Why a Dedicated Code Viewer?

Traditional IDEs (like VS Code and JetBrains) were architected when developers spent 8 hours a day manually typing code. They carry tens of thousands of features, bloated Electron/Node runtimes, complex file watchers, heavy background extensions, and gigabytes of memory overhead.

| Parameter | Traditional IDE (such as VS Code) | px0 (Code Viewer) |
| --------- | --------------------------------- | ----------------- |
| Primary Purpose | Manual code authoring and plugin host | Instant code reading and navigation |
| Base Memory (RSS) | ~1,440 MB (1.4+ GB) | ~16 MB (80x - 90x lighter) |
| Active Startup CPU Spike | 35% - 50% | < 1% |
| Cold Startup Time | Several seconds | Sub-millisecond |
| Process Tree | 15+ Node.js/Electron processes | 1 single static Go binary |
| Workspace Indexing | Multi-second background churn | 0 - 45 ms for entire repositories |
| Setup and Config | Config files, plugins, node, npm | Zero config, zero runtime |

When AI writes the code, your primary requirement is instant, distraction-free code understanding with deep LSP intelligence and zero machine lag.

## Key Numbers and Benchmarks

All metrics are measured on real-world repositories and reproducible using [`./benchmark.sh`](benchmark.sh).

### Real Corpus Performance (px0 standalone)

| Repository | Source Size | Files Indexed | Index Time | Fuzzy Search | Full-Tree Regex Scan | Resident RAM (RSS) |
| ---------- | ----------- | ------------- | ---------- | ------------ | -------------------- | ------------------ |
| flask | 3 MB | 235 | 1 ms | 0.8 ms | 2.3 ms | 16 MB |
| redis | 26 MB | 1,855 | 13 ms | 1.0 ms | 18.2 ms | 17 MB |
| react | 63 MB | 7,178 | 52 ms | 2.7 ms | 32.2 ms | 21 MB |
| django | 74 MB | 7,014 | 39 ms | 1.3 ms | 26.8 ms | 20 MB |
| kubernetes | 370 MB | 25,926 | 150 ms | 13.5 ms | 84.6 ms | 30 MB |
| TypeScript | 414 MB | 66,533 | 566 ms | 6.2 ms | 150.3 ms | 69 MB |
| linux kernel | 1,809 MB | 95,710 | 370 ms | 6.0 ms | 451.8 ms | 55 MB |

### Head-to-Head: px0 vs. VS Code

Run `./benchmark.sh --vscode .` to measure both on your active machine:

```
### px0 vs. VS Code Comparison

| Metric / Parameter | px0 | VS Code (Server/Remote) | Notes |
| ------------------ | --- | ----------------------- | ----- |
| **Memory (RSS)**   | **15 MB** | **1,166 - 1,440 MB**    | ~80x lighter |
| **Instant CPU %**  | **0.0%**  | **4.0% - 39.0%**        | Minimal CPU churn |
| **Index Time**     | **< 1 ms**| **~4 - 10 s**           | px0 is instantaneous |
| **Process Count**  | **1 single Go binary** | **15+ processes** | Multi-process Node tree |
```

## Features

- Blazing Fast Code Navigation: Fuzzy search files (`Cmd/Ctrl+P`), symbols (`Cmd/Ctrl+Shift+O`), and full project scan (`Cmd/Ctrl+Shift+F`) in milliseconds.
- Rich Syntax Highlighting: Built-in lexer support for ~280 languages via Chroma.
- Language Server Protocol (LSP): Zero-config auto-detection of existing LSPs (`gopls`, `rust-analyzer`, `pyright`, `typescript-language-server`, `clangd`, etc.) for Go-to-Definition (`F12`), Hover info, and references.
- Virtual DOM / Zero DOM Overhead: Opening a 400,000-line file costs the same as a 10-line file; only visible lines render in the browser.
- Clean Terminal Experience: CLI adheres to the Ape design spec with subtle 256-color palette, Unix pipe detection, and quiet automation modes.
- Completely Self-Contained: The single executable embeds HTML, CSS, and JS. No external assets or CDN dependencies.

## Installation

### Option 1: Prebuilt Binaries

Download the binary for your OS and architecture from `dist/`, make it executable, and place it on your `PATH`:

```bash
# macOS (Apple Silicon)
sudo install dist/px0-0.1.0-darwin-arm64 /usr/local/bin/px0

# Linux (x86_64)
sudo install dist/px0-0.1.0-linux-amd64 /usr/local/bin/px0
```

### Option 2: Build from Source

Requires Go 1.24 or newer. No npm, no node, no CGO, and no system libraries required:

```bash
git clone https://github.com/arpitbbhayani/lide.git
cd lide
go build -o px0 .
sudo install px0 /usr/local/bin/
```

To cross-compile binaries for all 15 supported OS and architecture combinations:

```bash
./build.sh
```

## Usage

Run `px0` pointing to any directory:

```bash
px0                 # view the current workspace
px0 ~/src/kernel    # view another repository
```

`px0` starts the local viewer, prints the URL, and opens your default browser immediately.

### CLI Flags

| Flag | Default | Description |
| ---- | ------- | ----------- |
| `-port N` | `7777` | Port to listen on (`0` picks an ephemeral free port) |
| `-host H` | `127.0.0.1` | Local address to bind |
| `-no-open` | `false` | Do not launch the web browser automatically |
| `-no-lsp` | `false` | Disable language server discovery and use regex-based outline |
| `-no-color` | `false` | Strip ANSI escape sequences from terminal output |
| `-quiet` | `false` | Suppress CLI narration (errors still print to stderr) |
| `-version` | `false` | Print version and architecture and exit |

## Keyboard Shortcuts

| Key | Action |
| --- | ------ |
| `Cmd/Ctrl+K` | Universal palette / quick open |
| `Cmd/Ctrl+P` | Go to file |
| `Cmd/Ctrl+Shift+P` | Command palette |
| `Cmd/Ctrl+Shift+O` | Go to symbol in file |
| `Cmd/Ctrl+Shift+F` | Full workspace search |
| `Cmd/Ctrl+F` | Find in active file |
| `Cmd/Ctrl+G` | Jump to line |
| `F12`, `Cmd/Ctrl+Click` | Go to definition |
| `Shift+F12` | Find all references |
| `Hover` | Type signature & doc hover |
| `Cmd/Ctrl + Hover` | Inspect identifier link |
| `Alt+Left` / `Alt+Right` | Navigate back / forward in history |
| `Cmd/Ctrl+B` | Toggle file tree sidebar |
| `Cmd/Ctrl+W` | Close active tab |
| `Ctrl+Tab` | Switch to next tab |
| `?` | Show all keyboard shortcuts |

## Reproducing Benchmarks

All benchmark figures can be measured directly on your own system:

```bash
# 1. Fetch benchmark corpus (~3 GB shallow clones of Linux, K8s, TypeScript, etc.)
./benchmark.sh --clone

# 2. Run the full benchmark suite
./benchmark.sh

# 3. Compare px0 directly against VS Code process tree on your workspace
./benchmark.sh --vscode .

# 4. Profile memory lifecycle across index, search, and idle recovery
./benchmark.sh --memory bench-repos/linux

# 5. Measure LSP latency (definition, hover, references)
./benchmark.sh --lsp .
```

See [BENCHMARKS.md](BENCHMARKS.md) for full methodology and detailed charts.

## Philosophy and Limits

- Read-Only by Design: px0 will never have a text editor. Code modifications belong to AI agents, CLI commands, or specific diff tools.
- Snapshot Indexing: By omitting file-system watcher daemons (`inotify` leaks, high CPU), indexing is near-instantaneous. Re-index at any time with `Cmd+Shift+P` -> `Re-index Workspace`.
- Local and Secure: Binds to `127.0.0.1` by default without any cloud or analytics phone-homes.

## Contributing

Contributions that keep px0 fast, minimal, and dependable are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting issues or pull requests.

### Development Workflow

1. Clone the repository:

```bash
git clone https://github.com/arpitbbhayani/lide.git
cd lide
```

2. Run tests:

```bash
go test ./...
```

3. Live frontend development (serves `web/` assets from disk without rebuilding the binary):

```bash
go run . -dev ./web .
```

4. Verify CLI formatting and builds:

```bash
go vet ./...
./build.sh
```

### Architecture Overview

- `main.go` / `ui.go`: CLI entrypoint, flag parsing, signal management, Ape terminal experience.
- `server.go`: HTTP routes, JSON API, gzip compression, and embedded asset serving.
- `index.go`: Concurrently walks workspace, honors `.gitignore`, builds in-memory path and trie structures in milliseconds.
- `search.go` / `fuzzy.go`: High-performance substring and fuzzy file/symbol matching algorithms.
- `lsp.go` / `lsp_client.go`: Lightweight JSON-RPC client communicating with local language servers over stdio.
- `web/`: Native zero-dependency ES module frontend (custom virtual scroll, syntax highlight rendering, tab manager).

## License

[MIT License](LICENSE) (c) 2026 Arpit Bhayani
