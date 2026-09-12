# Benchmarks

How to measure px0, and what it scores on real repositories.

## Requirements

- Go 1.24 or newer, to build the binary
- `git`, only for `--clone`
- `curl`, `awk`, `find`, `du` (present on any Linux or macOS install)
- About 3 GB of disk for the standard corpus
- Memory figures read `/proc`, so they are Linux only. Every other measurement works anywhere.

## Steps

1. Build the binary you want to measure.

```bash
go build -o px0 .
```

2. Fetch the corpus. Shallow clones of seven repositories, about 3 GB and a few minutes on a normal connection. Existing clones are left alone, so it is safe to re-run.

```bash
./benchmark.sh --clone
```

3. Run the benchmark. It starts a server per repository, measures it, and shuts it down.

```bash
./benchmark.sh
```

It prints a Markdown table you can paste anywhere. The corpus takes a few minutes end to end; the linux kernel alone reads 1.8 GB per scan.

The first run after a clone is slower everywhere, because the page cache is cold. Run it twice and report the second if you want steady-state numbers.

## The corpus

Seven repositories, chosen to span two orders of magnitude in size and to cover the language families people actually read. All are cloned shallow (`--depth 1`), so the numbers describe the working tree, not git history.

| Repo | Language | Why it is here |
| ---- | -------- | -------------- |
| [flask](https://github.com/pallets/flask) | Python | Small library, the fast case |
| [redis](https://github.com/redis/redis) | C | Mid-size C project with large single files |
| [react](https://github.com/facebook/react) | JavaScript | Many small files, deep nesting, many `.gitignore` files |
| [django](https://github.com/django/django) | Python | Large framework with a big test suite |
| [TypeScript](https://github.com/microsoft/TypeScript) | TypeScript | Very large files, plus a huge generated baseline tree |
| [kubernetes](https://github.com/kubernetes/kubernetes) | Go | Large Go monorepo with heavy vendoring |
| [linux](https://github.com/torvalds/linux) | C | The extreme: tens of thousands of files |

## Results

Measured on Linux, with language servers disabled (`-no-lsp`), so these are px0's own numbers.

| Repo | Source | Files | Index | Fuzzy | Full scan | Open big | Reopen | Mem | Peak |
| ---- | ------ | ----- | ----- | ----- | --------- | -------- | ------ | --- | ---- |
| django | 74 MB | 7014 | 39 ms | 1.3 ms | 26.8 ms | 166.8 ms | 1.0 ms | 20 MB | 29 MB |
| flask | 3 MB | 235 | 1 ms | 0.8 ms | 2.3 ms | n/a | n/a | 16 MB | 18 MB |
| kubernetes | 370 MB | 25926 | 150 ms | 13.5 ms | 84.6 ms | 199.0 ms | 0.9 ms | 30 MB | 44 MB |
| linux | 1809 MB | 95710 | 370 ms | 6.0 ms | 451.8 ms | 26.7 ms | 0.6 ms | 55 MB | 73 MB |
| react | 63 MB | 7178 | 52 ms | 2.7 ms | 32.2 ms | 57.7 ms | 0.7 ms | 21 MB | 28 MB |
| redis | 26 MB | 1855 | 13 ms | 1.0 ms | 18.2 ms | 80.8 ms | 1.2 ms | 17 MB | 27 MB |
| typescript | 414 MB | 66533 | 566 ms | 6.2 ms | 150.3 ms | 40.9 ms | 6.5 ms | 69 MB | 105 MB |

## px0 vs. VS Code Comparison

Direct side-by-side comparison on the same machine (Linux x86_64, standard developer workspace):

| Metric / Parameter | px0 | VS Code (Remote / Server) | Ratio / Difference |
| ------------------ | --- | ------------------------- | ------------------ |
| Startup Memory (Base RSS) | ~16 - 18 MB | ~1,440 MB (1.41 GB) | ~80x lighter |
| Idle Background Memory | ~16 MB | ~1,440 MB | ~90x lighter |
| Active Startup CPU Spike | < 1% | ~39% - 47% | Minimal churn |
| Steady Idle CPU | 0.0% | 0.0% - 1.0% | Comparable |
| Workspace Index Time | < 1 ms | ~4 - 10 s | Instant indexing |
| Process Model | 1 single Go binary | 15+ processes (Server main, extensionHost, PTY host, fileWatcher, socket proxies, LSPs) | Lean footprint |
| Architecture | Zero-runtime browser-driven | Node.js + Electron / V8 runtime | No V8 heap overhead |

### VS Code Breakdown (Measured Process Tree)

When VS Code starts on the workspace, its resident memory breaks down across the multi-process tree:

- Extension Host (`bootstrap-fork --type=extensionHost`): ~500 MB RSS, ~39% CPU during extension discovery and activation
- Language Server (`pyrefly lsp` / `jsonServerMain`): ~350 MB RSS
- VS Code Server Main (`server-main.js`): ~260 MB RSS
- File Watcher (`bootstrap-fork --type=fileWatcher`): ~68 MB RSS
- PTY Host / Terminal (`bootstrap-fork --type=ptyHost` + shells): ~71 MB RSS
- IPC Proxies & Utility Scripts: ~190 MB RSS

In contrast, `px0` handles file indexing, fuzzy search, syntax highlighting, and server endpoints in a single native Go process with a baseline memory footprint of under 20 MB.

## What each column measures

| Column | Measurement |
| ------ | ----------- |
| `Source` | Working tree size, excluding `.git` |
| `Files` | Files actually indexed, after `.gitignore` and the built-in excludes |
| `Index` | One full directory walk at startup, reported by the server itself |
| `Fuzzy` | Fuzzy match of a query against every indexed path |
| `Full scan` | Literal search for a string that matches nothing, so every indexed file is read end to end. The worst case for search. |
| `Open big` | First open of the largest source file, cold: read, lex the visible window, return it |
| `Reopen` | The same request once cached |
| `Mem` | Resident memory after indexing |
| `Peak` | Resident memory at the end of the run, before the idle release |

Timings are the fastest of `RUNS` requests, which reports the cost when the page cache is warm. Index time is a single cold measurement, since a process only starts once.

## Reading the numbers

Search is disk-bound. A full scan reads every indexed byte, so it tracks source size rather than file count. Everything else is CPU-bound and tracks file count.

Opening a file does not depend on its length. The server lexes the requested window plus a little context, never the whole file, and the browser only renders the lines on screen. A 100,000-line file opens in about the same time as a 1,000-line one.

Memory stays flat as you read. The highlight cache evicts at 512 MB, counting the rendered HTML as it accumulates rather than guessing from the source size, and only the visible lines ever reach the browser. `Peak` is the high-water mark during the run; run `--memory` to see where it settles.

## Other things to measure

Benchmark directories you already have, instead of the corpus:

```bash
./benchmark.sh ~/src/myproject ~/src/another
```

Trace resident memory through indexing, searching and reading a file:

```bash
./benchmark.sh --memory bench-repos/linux
```

```
### linux
  after indexing                     59 MB
  after a fuzzy find                 59 MB
  after 5 full-tree searches         85 MB
  after opening the largest file     88 MB
  after scrolling through it         94 MB
  8 seconds idle                     94 MB
  30 seconds idle                    57 MB
```

Resident memory includes pages the Go runtime has freed but not yet returned to the OS, which is why the figure keeps climbing while work is happening and then drops. px0 hands those pages back after fifteen seconds of inactivity, so the last line is the one that describes a session sitting open.

Time the language server path. This one leaves language servers enabled, picks a source file the index holds, waits for the server to finish indexing, and asks about a declaration from the server's own outline:

```bash
./benchmark.sh --lsp .
```

```
### px0
  servers: "gopls","rust-analyzer"
  probe:   fuzzy.go
  server ready after         374 ms  (spawn and index, paid once)
  symbol                     isBoundary at line 17, column 5
  go to definition           1.5 ms
  find all references        3.0 ms
  hover                      5.1 ms
  document outline           1.4 ms
  px0 memory                18 MB   (px0 only; servers are separate processes)
  gopls memory               122 MB
```

Compare px0 directly against running VS Code, vanilla VS Code, and other editors:

```bash
# Compare against running VS Code process tree (extensions enabled)
./benchmark.sh --vscode .

# Benchmark an isolated, clean vanilla VS Code instance (no extensions, clean user-data-dir)
./benchmark.sh --vscode-vanilla .

# Compare multi-editor overview (px0 vs. VS Code, Neovim, Vim, etc.)
./benchmark.sh --editors .
```

```
### Measuring px0 on . ...

### px0 vs. VS Code Comparison

| Metric / Parameter | px0 | VS Code (Server/Remote) | Notes |
| ------------------ | --- | ----------------------- | ----- |
| **Memory (RSS)** | **15 MB** | **1166.4 MB** | 78x lighter |
| **Instant CPU %** | **0.0%** | **4.0%** | Measured over 1s |
| **Index Time** | **0 ms** (48 files) | **~4 - 10 s** | px0 is immediate |
| **Process Count** | **1 single Go binary** | **15 processes** | Multi-process Node tree |

#### VS Code Process Breakdown

| PID | Role / Component | RSS (MB) | CPU % |
| --- | ---------------- | -------- | ----- |
| 388357 | Extension Host | 345.5 MB | 4.0% |
| 388724 | LSP: Pyrefly | 288.4 MB | 0.0% |
| 388075 | VS Code Server Main | 146.1 MB | 0.0% |
| 388113 | File Watcher | 67.9 MB | 0.0% |
| 388089 | IPC / Socket Proxy | 64.7 MB | 0.0% |
| 388715 | LSP: JSON Language Server | 63.0 MB | 0.0% |
| 388697 | PTY Host (Terminal) | 62.8 MB | 0.0% |
| 388098 | IPC / Socket Proxy | 52.9 MB | 0.0% |
| 388427 | Remote Containers Extension | 51.6 MB | 0.0% |
| 388708 | Integrated Terminal (bash) | 8.9 MB | 0.0% |
```

Run `./benchmark.sh --help` for the full list.

## Options

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `BIN` | `./px0` | Binary to measure |
| `CORPUS` | `./bench-repos` | Where the corpus lives |
| `PORT` | `7900` | First port to use, incremented per repo |
| `RUNS` | `5` | Requests per timing, the fastest is reported |

Use them like this:

```bash
RUNS=20 ./benchmark.sh bench-repos/redis           # more samples, less noise
BIN=./dist/px0-0.1.0-linux-arm64 ./benchmark.sh   # measure a release build
CORPUS=/mnt/big/repos ./benchmark.sh --clone       # put the corpus elsewhere
```

## Notes on methodology

- The default table runs with `-no-lsp`. Language servers are separate processes with their own cost, measured by `--lsp`.
- Each repository gets a fresh server process, measured, then killed. Nothing is shared between rows.
- The corpus is cloned shallow, so `.git` is small, and it is excluded from the source size anyway.
- `Index` is measured once per process and includes reading every `.gitignore` in the tree.
- Small timings move by a factor of two between runs on a loaded machine. Raise `RUNS` and close other work before quoting them.
- `Full scan` deliberately searches for a string that matches nothing. A query with hits stops early once it reaches the result cap, which would measure less work, not more.

## Adding a repository

Add a line to `REPOS` near the top of `benchmark.sh`:

```
name|https://github.com/owner/name
```

Then run `./benchmark.sh --clone` again. Existing clones are left alone, so only the new one is fetched.

## Cleaning up

The corpus is the only thing the script leaves behind, and `.gitignore` already excludes it.

```bash
rm -rf bench-repos
```
