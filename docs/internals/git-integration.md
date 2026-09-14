# Git Awareness & Diffing

This document describes the design and implementation of px0's git integration engine ([`git.go`](../../git.go)).

---

## 1. Zero-Dependency Shell-Out Architecture

px0 avoids heavy third-party Go git libraries (such as `go-git`, which can consume large amounts of memory re-parsing packfiles, or `libgit2`, which requires CGO).

Instead, px0 adheres to a **Pure Shell-Out Architecture**:
- Shells out directly to the host `git` binary.
- Purely read-only: never stages, commits, or mutates repository state.
- Zero disk footprint: holds all status and diff structures in volatile memory on the `Index` (`Node.Status`).
- Graceful degradation: if `git` is not installed, or if the opened directory is not a git repository, git features degrade silently without warnings or errors.
- Can be disabled explicitly using the `-no-git` CLI flag.

---

## 2. Concurrent Status Generation

On large repositories, running `git status` can take 50–100 milliseconds. Running this serially during startup would delay index readiness.

px0 runs `git status` concurrently alongside the filesystem walk:

```go
gsCh := make(chan map[string]string, 1)
go func() { gsCh <- gitStatus(ix.root) }()

// Walk directory tree concurrently...
walk(ix.root, "", root)

// Overlay git status onto index nodes
gs := <-gsCh
```

### Git Command Specification:
px0 invokes:
```bash
git status --porcelain=v2 -z
```
- `--porcelain=v2`: Machine-readable format immune to user git config customizations.
- `-z`: NUL-delimited output preventing issues with filenames containing spaces, tabs, quotes, or Unicode characters.

---

## 3. In-Memory Status & Dirty Folder Propagation

Git status codes are mapped onto tree nodes:
- `M`: Modified
- `A`: Added / Staged
- `D`: Deleted
- `U`: Untracked
- `R`: Renamed

### Ancestor Folder Dirty Propagation (`Node.Dirty`)
When a file is modified, its status is recorded on its `Node.Status`. Furthermore, every ancestor folder in its path hierarchy is marked `Dirty: true`:

```go
for p := rel; p != ""; {
    if i := strings.LastIndexByte(p, '/'); i >= 0 {
        p = p[:i]
    } else {
        p = ""
    }
    for i := range children[p] {
        if children[p][i].Dir && isAncestor(children[p][i].Path, rel) {
            children[p][i].Dirty = true
        }
    }
}
```

This enables the file tree in the sidebar to visually highlight collapsed directories that contain modified descendants, allowing developers to immediately spot repository changes.

---

## 4. Gutter Change Markers & Unified Diffs

### Gutter Change Indicators (`/api/gutter?path=...`)
When viewing a file, the editor displays green, blue, and red markers in the line gutter indicating local edits:
1. `gitGutter(root, rel)` runs:
   ```bash
   git diff --no-ext-diff --no-color -U0 HEAD -- <path>
   ```
2. The zero-context unified diff chunks (`@@ -l,s +l,s @@`) are parsed into line ranges:
   - `added`: Newly inserted lines.
   - `modified`: Altered lines.
   - `deleted`: Lines removed relative to `HEAD`.

### File Diff Viewer (`/api/diff?path=...`)
Pressing `Cmd+D` / `Ctrl+D` displays the complete unified diff against `HEAD`:
1. Generated via `git diff --no-ext-diff --no-color -U3 HEAD -- <path>`.
2. Rendered in the browser with syntax styling via `web/src/diff.js`.
