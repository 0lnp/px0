# px0

A read-only IDE for reading and navigating code. One binary, no runtime, no config.

It does not edit files. Everything in it exists to answer "where is this, and what does it look like".

## Install

Download the binary for your platform from `dist/`, or build it yourself.

```bash
go build -o px0 .
```

Go 1.24 or newer. There is nothing else to install: no npm, no CGO, no system libraries. To build every platform at once, run `./build.sh`.

To put it on your `PATH`:

```bash
sudo install px0 /usr/local/bin/
```

## Use

```bash
px0                  # read the current directory
px0 ~/src/kernel     # read another directory
```

It indexes the directory and opens your browser. That is the whole setup.

Flags:

| Flag | Meaning |
| ---------- | ------------------------------------------ |
| `-port N`  | Port to listen on, default 7777 |
| `-host H`  | Address to bind, default `127.0.0.1` |
| `-no-open` | Print the URL instead of opening a browser |
| `-no-lsp`  | Do not use language servers |
| `-version` | Print the version and exit |

## Features

- Syntax highlighting for about 250 languages
- Fuzzy file finder over the whole tree
- Project-wide search, literal or regex, with whole-word and glob filters
- Symbol outline per file, and jump to symbol
- Go to definition and find all references
- Hover for the type signature and documentation
- Find in file, with a match count and a position minimap
- File tree, tabs, breadcrumbs, back and forward history
- Dark and light themes
- Respects `.gitignore` at every directory level

## Keyboard

| Key | Action |
| ---------------------- | ------------------------------- |
| `Ctrl+P`               | Go to file |
| `Ctrl+Shift+O`         | Go to symbol |
| `Ctrl+G`               | Go to line |
| `Ctrl+Shift+P`         | Command palette |
| `Ctrl+Shift+F`         | Search in files |
| `Ctrl+F`               | Find in file |
| `Enter`, `Shift+Enter` | Next and previous match |
| `F12`, `Ctrl+Click`    | Go to definition |
| `Shift+F12`            | Find all references |
| Hover                  | Type and documentation |
| `Ctrl` + hover         | Show the identifier as a link |
| `Alt+Left`, `Alt+Right`| Navigate back and forward |
| `Ctrl+B`               | Toggle the sidebar |
| `Ctrl+W`               | Close tab |
| `Ctrl+Tab`             | Next tab |
| `Alt+1` to `Alt+9`     | Select a tab |
| Double click           | Highlight all occurrences |
| `?`                    | Show all shortcuts |

In the palette, a leading `:` means line, `@` means symbol, and `>` means command.

## Build size

A single statically linked binary with no dynamic dependencies. Roughly 9.5 MB on every platform.

The UI ships inside it. `go:embed` bakes `web/index.html`, `web/app.js` and `web/style.css` into the executable, so the binary is the whole program: copy it to an empty directory, run it there, and it still serves the full interface. There are no files to install alongside it.

Where the size goes:

| Part | Size |
| ------------------------------- | -------- |
| Syntax highlighting lexer data   | ~1.9 MB across 279 languages |
| Embedded UI (HTML, CSS, JS)      | 74 KB, under 1 percent |
| Go runtime and everything else   | the remainder |

| Platform | Size |
| --------------- | ------- |
| linux/amd64     | 9.8 MB |
| linux/arm64     | 9.3 MB |
| darwin/arm64    | 9.4 MB |
| darwin/amd64    | 9.9 MB |
| windows/amd64   | 10.0 MB |

Also builds for linux `arm`, `386` and `riscv64`, windows `arm64` and `386`, and freebsd, openbsd and netbsd. Fifteen targets in total.

## Memory

Measured with `VmRSS` on Linux.

| State | Memory |
| ------------------------------------------ | ------ |
| Idle on a small repository                  | 15 MB |
| Go standard library indexed, 9,999 files    | 20 MB |
| Linux kernel indexed, 95,710 files          | 55 MB |
| Linux kernel, after five full-tree searches | 85 MB |
| Linux kernel, once idle again               | 57 MB |

Reading a large tree churns through a lot of short-lived memory, and the Go runtime keeps those pages for a while. px0 returns them after fifteen seconds of inactivity, so an open session settles back down rather than sitting on its high-water mark. Trace it yourself with `./benchmark.sh --memory <dir>`.

Memory does not grow without bound. The highlight cache evicts at 512 MB, and the browser only ever holds the lines you can see.

Language servers are separate processes with their own appetite. `gopls` on this repository uses about 122 MB while px0 stays at 14 MB. Run with `-no-lsp` if you would rather not pay that.

## Benchmarks

`benchmark.sh` measures index time, search, file open and memory against real repositories, and prints a Markdown table.

```bash
go build -o px0 .
./benchmark.sh --clone              # fetch the corpus, about 3 GB
./benchmark.sh                      # measure everything in it
./benchmark.sh ~/src/mine           # or measure your own repo
./benchmark.sh --memory ~/src/mine  # trace resident memory
./benchmark.sh --lsp ~/src/mine     # time the language server path
./benchmark.sh --help               # everything it can do
```

The corpus spans two orders of magnitude in size: [flask](https://github.com/pallets/flask), [redis](https://github.com/redis/redis), [react](https://github.com/facebook/react), [django](https://github.com/django/django), [TypeScript](https://github.com/microsoft/TypeScript), [kubernetes](https://github.com/kubernetes/kubernetes) and [linux](https://github.com/torvalds/linux).

See [BENCHMARKS.md](BENCHMARKS.md) for results, what each column means, and how to add a repository.

## Speed

Measured on the Go standard library: 9,999 files, 145 MB of source.

| Operation | Time |
| --------------------------------------------- | ---------------- |
| Index the whole tree                            | 45 ms |
| Fuzzy file find                                 | 1.8 ms |
| Search the whole tree, reading every file       | 51 ms |
| Open the largest file                           | 32 ms |
| Reopen it                                       | 5 ms |
| Repaint while scrolling                         | 2.7 ms per frame |

The same run against the linux kernel, 95,710 files and 1.8 GB of source: index 370 ms, fuzzy find 6 ms, full search 452 ms.

Reproduce any of this with `./benchmark.sh`. See [BENCHMARKS.md](BENCHMARKS.md).

Opening a 400,000-line file costs the same as opening a 10-line one. The browser only renders the visible lines, and the server only highlights the part you are looking at.

## Language servers

If a language server is on your `PATH`, px0 uses it for definitions, references, hover and the outline. If it is not, everything still works from the text index. There is nothing to configure either way.

Detected automatically: `gopls`, `rust-analyzer`, `pyright-langserver`, `pylsp`, `ruff`, `typescript-language-server`, `clangd`, `zls`, `lua-language-server`, `solargraph`, `jdtls`, `omnisharp`, `texlab`.

Servers start when you open a file they handle, not at startup, so indexing still finishes in milliseconds. Until one is ready, navigation falls back to text search. The status bar shows which engine answered. Servers shut down when px0 exits, including on `Ctrl+C`.

Once warm, against `gopls`:

| Operation | Time |
| -------------------- | ------ |
| Go to definition      | 2 ms |
| Find all references   | 5 ms |
| Hover                 | 3 ms |
| Document outline      | 5 ms |

Jumping to a definition outside the tree works, so you can follow a call into the standard library or a dependency.

## Limits

- It is read-only, on purpose.
- Without a language server, go to definition and the outline use regular expressions. They are approximate and instant. The panel tells you which engine answered.
- The index is a snapshot. There is no file watcher, so re-index from the explorer header or the command palette after files change on disk.
- Binary files are refused, as is anything over 64 MB. Images render as images.
- It binds `127.0.0.1`. The `-host` flag will bind elsewhere, but there is no authentication, so anyone who can reach the port can read the tree.

## Development

```bash
go test ./...          # unit and correctness tests
px0 -dev . <dir>      # serve the UI from disk, no rebuild needed
```

The UI is plain HTML, CSS and JavaScript in `web/`, embedded into the binary with `go:embed`. There is no build step and no framework.
