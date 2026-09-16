# Harness Editing & Agent Dispatch

This document describes the design and implementation of px0's editing flow ([`agent.go`](../../agent.go)), its persisted choice ([`settings.go`](../../settings.go)), and its instruction composer ([`web/src/agent.js`](../../web/src/agent.js)).

Harnesses are discovered automatically, the same way language servers are. Editing becomes available as soon as px0 finds one installed, but nothing ever runs until the user picks one, and that choice is remembered between runs. `-no-agent` removes the feature entirely; `-agent` pins a harness for scripted use and takes the choice away from the UI.

## 1. The Dispatcher Model

px0 remains a reader. It does not open a file for writing, and no endpoint accepts file content.

Editing works by delegation:

1. The user selects a range and writes an instruction anchored to it.
2. px0 composes a prompt from that instruction plus the referenced source.
3. px0 spawns a coding harness already installed on the machine, with the workspace as its working directory.
4. The harness makes the change.
5. px0 reloads what moved and hands the user its existing diff view to review it.

An edit can be started from either surface: the code viewport, or the git diff view. In the diff view only working-tree lines can anchor one, because a deleted line belongs to HEAD and has nothing on disk to point at, so a selection covering only deletions offers no edit at all.

This keeps the hot path (indexing, highlighting, navigation) untouched, and confines the whole feature to two Go files, one ES module, and five endpoints.

## 2. Discovery, Selection and the Settings File

`Detect` walks the preset list and resolves each harness with `lookPathIn(name, lspBinDirs())`, the same helper the language-server manager uses. That search covers PATH plus the directories these tools actually install into, such as `~/.local/bin` and npm's global prefix. It runs on every `/api/agent/harnesses` call, so a harness installed after startup appears without a restart.

Discovery alone never enables editing. Finding `claude` on PATH is not consent to let it rewrite a workspace, so the first edit opens a picker and the choice is explicit. Once made, it is remembered and the picker stays out of the way.

The choice is the only thing px0 persists. It is written to:

```
$XDG_CONFIG_HOME/px0/settings.json     # when XDG_CONFIG_HOME is set
~/.px0/settings.json                   # otherwise
```

```json
{
  "agent": "claude"
}
```

This follows `stateFilePath` in [`update.go`](../../update.go) and sits beside the anonymous ID written by [`telemetry.go`](../../telemetry.go). The tenet it respects is that nothing is written into a working tree: there is no `.px0/` directory in the repository, and a workspace a user only reads stays byte-for-byte untouched.

A corrupt or stale settings file is never an error. If the saved harness has since been uninstalled it simply resolves to nothing selected, and the picker appears again.

The spec is persisted exactly as the user gave it. A command template shortens to its binary name for display, so saving the display name would break the round trip.

## 3. The Invocation Contract

Every supported harness starts an interactive session by default and blocks on an approval prompt. A naive spawn therefore hangs forever, producing no output and no error. Each preset carries both the flag that makes the run headless and the flag that lets it apply edits unattended:

| Harness | Argv |
| --- | --- |
| `claude` | `claude -p --permission-mode acceptEdits {prompt}` |
| `gemini` | `gemini --approval-mode auto_edit -p {prompt}` |
| `cursor-agent` | `cursor-agent -p --force {prompt}` |

A full command template is accepted anywhere a harness name is, and must contain `{prompt}`:

```bash
px0 -agent "claude -p --permission-mode acceptEdits {prompt}"
```

The template is split on whitespace, and `{prompt}` is substituted inside each token, so both `{prompt}` and `--prompt={prompt}` work. Presets are a convenience, not a coupling: because a template is always available, a harness that changes its flags is a one-line fix by the user rather than a px0 release.

The binary is resolved before a harness can be selected, so a typo or an uninstalled tool fails at the point of choosing rather than on first use.

### Stdin Stays Empty

`cmd.Stdin` is never set. A harness that still decides to ask something reads EOF and exits, which surfaces as an error in the job log. This mirrors the same decision in the language-server installer ([`lspsetup.go`](../../lspsetup.go)) and is the difference between a failed run and a hung one.

## 4. Single-Flight and the Dirty Guard

One edit runs at a time for the whole workspace. Two harnesses rewriting one tree concurrently produces a state nobody can review afterwards, so a second dispatch is refused with `409` while one is in flight. Changing the harness mid-run is refused for the same reason.

px0 has no undo of its own, and deliberately does not build one: git is the undo. That makes one case worth stopping for. If the target file already holds uncommitted work, that work is unrecoverable once a harness writes over it, so the first dispatch is refused:

```
main.go has uncommitted changes that this edit would write over
```

The UI asks once and retries with `force=1`. Untracked files are covered too, because the check reads `gitStatus` rather than `git diff HEAD`.

### Editing From the Diff View

A file open in the diff view has uncommitted changes by definition, so the guard would fire on every edit started there and teach the user to click through it. The guard exists to make invisible changes visible; in the diff view they are on screen and are the reason the user is looking. Edits dispatched from there therefore skip the confirm, and the composer says `Editing uncommitted changes` in place of it.

Diff rows carry their working-tree line number in `data-l`: on the row itself for additions and context in the unified layout, and on the right-hand side in the split layout. The selection reads its anchor from those attributes and gathers its text from the `.diff-code` cells alone, so the line-number and `+`/`-` gutters never leak into a prompt.

After the run, the reload replaces the tab's document without its cached `diffText`, so `syncDiffView` refetches `/api/diff` and the diff the user is looking at reflects the edit that was just made.

## 5. Determining What Changed

A harness routinely edits files nobody pointed it at, so the set of touched files is never inferred from the prompt. `changedSince` snapshots `gitStatus` before the run and compares it after, in both directions:

- A path whose status is new or different was touched.
- A path that has left the status list entirely was restored to its committed state, which is also a change.

That set drives both the reload and the summary shown to the user.

Outside a git repository there is no status to compare, so the job reports `tracked: false` and an empty change list. The client treats that as "unknown" rather than "nothing" and reloads the workspace regardless.

## 6. The Reload Path

The syntax highlighting cache memoises on `path + mtime + size` ([`highlight.go`](../../highlight.go)), so a rewritten file misses the cache on its own and no invalidation is needed for the common case. Two things still need explicit handling:

- Torn reads. `Open` stats and then reads, non-atomically. A harness that truncates and writes in place can be caught mid-write, and that partial copy would then sit under a cache key nothing invalidates. Every changed file is therefore passed to `Evict` before the reload.
- Stale language servers. `gopls` and friends hold their own copy of a file and never saw the write, so go-to-definition and hover would drift. Each changed file is passed to `lsp.CloseDoc`, and the server reopens it on the next request.

The frontend then reloads in dependency order: `/api/reindex` first so the tree and git badges agree with disk, then `reloadOpenTabs()`, which preserves scroll position, cursor line, markdown preview scroll and diff mode across the swap, then a tree redraw.

### No File Watcher

px0 dispatched the harness, so it knows when the work ended. Completion is detected by the process exiting, not by watching the filesystem. There is no `fsnotify` dependency, no polling of the tree, and the single-binary, zero-dependency footprint is unchanged.

## 7. HTTP Surface

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/agent/harnesses` | GET | Re-scan and list every known harness with its installed state. |
| `/api/agent/select` | POST | Choose a harness and remember it. An empty name turns editing off. |
| `/api/agent/edit` | POST | Dispatch an instruction for `path:l1-l2`. |
| `/api/agent/job` | GET | Snapshot of the current or most recent run, polled while running. |
| `/api/agent/cancel` | POST | Stop a running harness. Whatever it already wrote stays. |

`/api/meta` carries `agent` (the selected name, or empty), `agentPinned`, and `agents` (the detected list), so the UI can decide at boot whether to offer the button without a second request.

Every mutating endpoint is guarded by `localPost` ([`lspsetup.go`](../../lspsetup.go)): POST only, `Origin` must match `Host`, and `Host` must be an IP address or `localhost`, which shuts out DNS rebinding.

### Security Posture

This endpoint runs a general-purpose coding agent with shell access as the user who started px0. `localPost` restricts it to a browser page served from this machine, which is why editing is unavailable over the tunnelled and reverse-proxied setups described in the README. Exposing it remotely requires an authentication story px0 does not yet have.

The explicit first-run pick matters for the same reason. Auto-enabling on discovery would mean any px0 instance on a machine with a harness installed is a code execution endpoint that nobody opted into.

## 8. Limits

- The job log keeps the last 32 KB of harness output (`tailBuffer`), enough to explain a failure without holding a full transcript.
- A run is abandoned after 10 minutes.
- Instructions live in memory for the life of the process. Only the harness choice is persisted, and never inside a workspace.
