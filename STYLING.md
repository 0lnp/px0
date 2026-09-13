# Styling and Themes

px0 reads every colour in the UI through a CSS custom property, called a token. A theme is one CSS file that assigns those tokens. This document explains how themes load, how to write one, and what each token controls.

## How Themes Load

- `web/style.css` holds layout and component styles. It contains no literal colours. Its `:root` block defines the structural tokens (fonts, sizes) and fallbacks for the optional colour tokens.
- `web/themes/<id>.css` holds one theme: a single rule for `:root[data-theme="<id>"]`. The file name is the theme id.
- The server joins every `web/themes/*.css` file in file name order and serves the result at `/static/themes.css`. `web/index.html` links it after `style.css`. No registry lists the themes.
- `web/src/theme.js` discovers themes at boot. It scans the loaded stylesheets for rules whose whole selector is `[data-theme="<id>"]`, optionally prefixed by `:root` or `html`. It reads the display name from `--theme-name` and the light or dark hint from `color-scheme`.
- The active theme is the `data-theme` attribute on `<html>`. The choice persists in `localStorage` under `px0.theme`. If the saved id no longer exists, px0 uses the default from `index.html` (`github-dark`), or the first discovered theme if that one is gone too.

Theme rules use `:root[data-theme="<id>"]` rather than `[data-theme="<id>"]` on purpose. The extra `:root` raises specificity above the fallbacks in `style.css`, so a theme always wins regardless of stylesheet order.

## Built-in Themes

| Name             | Id                 | Scheme | Based on                     |
| ---------------- | ------------------ | ------ | ---------------------------- |
| Catppuccin Latte | `catppuccin-latte` | light  | Catppuccin palette           |
| Catppuccin Mocha | `catppuccin-mocha` | dark   | Catppuccin palette           |
| Dracula          | `dracula`          | dark   | Dracula palette              |
| GitHub Dark      | `github-dark`      | dark   | GitHub dark, the default     |
| Gruvbox Dark     | `gruvbox-dark`     | dark   | Gruvbox palette              |
| Gruvbox Light    | `gruvbox-light`    | light  | Gruvbox palette              |
| Monokai          | `monokai`          | dark   | Classic Monokai palette      |
| Nord             | `nord`             | dark   | Nord palette                 |
| One Dark         | `one-dark`         | dark   | One Dark palette             |
| Paper            | `light`            | light  | Original, GitHub light style |
| Rose Pine        | `rose-pine`        | dark   | Rose Pine palette            |
| Solarized Dark   | `solarized-dark`   | dark   | Solarized palette            |
| Solarized Light  | `solarized-light`  | light  | Solarized palette            |
| Tokyo Night      | `dark`             | dark   | Tokyo Night                  |

Each theme maps its source palette onto px0's tokens. UI surfaces and some syntax roles are adapted to fit px0, so colours follow the original palette without matching any single editor port exactly. Catppuccin Latte darkens its yellow, peach, sky, green, pink and lavender tones, which fall below 3:1 contrast on its light base otherwise. Solarized, Nord and One Dark keep their canonical values even where a few tones sit slightly below that line.

## Switching Themes

The picker and the sidebar button list themes sorted by display name.

- Click the moon button at the bottom of the file sidebar to cycle to the next theme.
- Run `Select Theme` from the command palette (`Ctrl+Shift+P`, `Cmd+Shift+P` on macOS) to pick from a list. Arrow keys preview each theme live, `Enter` keeps the highlighted one, and `Esc` restores the previous one.
- Run `Next Theme` from the command palette to cycle without the list.

## Creating a Theme

1. Copy the built-in theme closest to what you want, for example `cp web/themes/dark.css web/themes/midnight.css`.
2. Change the selector to match the new file name: `:root[data-theme="midnight"]`. Use letters, digits, `-` and `_` in the id.
3. Set `--theme-name` to the label the picker shows, and `color-scheme` to `dark` or `light`.
4. Edit the colour tokens using the reference below. Delete any optional token you want to derive from the required ones.
5. Preview without rebuilding. From the repository root run `go run . -dev . .` (the first `.` is the directory containing `web/`, the second is the workspace to open). `-dev` serves `web/` from disk, so a browser reload picks up every CSS edit. Open the palette and run `Select Theme`.
6. Run `go test ./...`. `TestThemesStylesheetJoinsEveryThemeFile` fails if a theme file has no `:root[data-theme="<id>"]` rule matching its file name, or leaves out a required token.
7. Build the binary with `go build -o px0 .` or `./build.sh`. `go:embed` bundles the new file, so the theme ships inside the single executable.

### Minimal Theme

A theme only needs the required tokens. Everything else falls back to a value derived from them. This file is a complete, working theme:

```css
/* Midnight: an example theme. Token reference: STYLING.md. */
:root[data-theme="midnight"] {
  --theme-name: "Midnight";
  color-scheme: dark;

  --bg: #002b36; --bg2: #00252e; --bg3: #073642; --bg4: #0d4452;
  --fg: #93a1a1; --dim: #839496; --faint: #586e75;
  --line: #0a3b47; --accent: #268bd2; --accent-fg: #2aa198;
  --sel: #0f4b5c; --mark: #4a3f0b; --mark-active: #7a4a12; --cur: #04313c;
  --shadow: 0 16px 48px rgba(0, 0, 0, 0.6);

  --k: #859900; --nf: #268bd2; --s: #2aa198; --m: #d33682; --c: #586e75; --err: #dc322f;
}
```

### Theme-Specific Component Overrides

Tokens cover colour. When a theme needs a different shape, scope a normal rule to the theme in the same file:

```css
:root[data-theme="midnight"] .tab.active::after { height: 2px; }
:root[data-theme="midnight"] .c .k { font-weight: 600; }
```

Discovery ignores these rules because their selector is more than the theme attribute. Keep overrides rare. Each one couples the theme to markup that can change.

## Token Reference

Required tokens have no fallback. A missing required token makes every `var()` that reads it invalid, so the property reverts to its inherited or initial value and the element renders unstyled. Optional tokens list their fallback.

### Theme Metadata

| Property       | Required               | Purpose                                                                                                                    |
| -------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `--theme-name` | No, defaults to the id | Label in the theme picker and in the toast shown when cycling.                                                             |
| `color-scheme` | No                     | `dark` or `light`. The browser styles native scrollbars, form controls and placeholder text to match. The picker shows it. |

### Surfaces

Four steps from the editor outward. Each step should read as slightly raised against the one before it.

| Token   | Required | Controls                                                                                                                                                                        |
| ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--bg`  | Yes      | Editor, line-number gutter, active tab, empty screen, text inputs, hover card signature block, key hints in the status bar, scrollbar thumb border, Markdown preview.                             |
| `--bg2` | Yes      | File tree sidebar, tab bar, right inspector, status bar, hover card action row, Markdown code blocks and table headers.                                                                                                 |
| `--bg3` | Yes      | Floating surfaces (hover card, find bar, palette, shortcut sheet, toast), row hover, key caps, count badges, active search toggles, image preview checkerboard, inline code and the code block copy button in the Markdown preview, the Markdown Preview / Source switch (its selected half uses `--bg` and `--accent-fg`).                 |
| `--bg4` | Yes      | Hover on small buttons (tab close, find bar, status bar), active status bar buttons, double-click occurrence highlight, version badge, scrollbar thumb.                         |

### Text

| Token     | Required | Controls                                                                                                                                             |
| --------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--fg`    | Yes      | Primary text, directory names, active tab, current line number, plain identifiers in code.                                                           |
| `--dim`   | Yes      | Secondary text: inactive tabs, file names in the tree, hover card docs, panel headings, Markdown blockquotes and footnotes. Also the badge fill for file extensions and untyped symbols. |
| `--faint` | Yes      | Tertiary text: line numbers, hints, counters, tree chevrons, close buttons at rest, read-only badge in the sidebar header, LSP dot when off, scrollbar thumb on hover, code block language label in the Markdown preview. |

### Borders and Accent

| Token         | Required | Controls                                                                                                                                                                                          |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--line`      | Yes      | Every border and divider, occurrence outline, empty screen logo, Markdown heading rules, tables, blockquotes and code blocks.                                                                                                                                  |
| `--accent`    | Yes      | Active tab indicator, input focus border, resizer drag handle, Ctrl-hover link underline, palette mode chip, button hover fill, toast border, active search toggle border, key hint hover border, status bar top edge and chip in selection mode, Markdown task checkboxes. |
| `--accent-fg` | Yes      | Accent-coloured text: active inspector tab, matched characters in the palette, Markdown headings in the code view, links in the Markdown preview, version labels, status bar button hover, active search toggles, search result source labels.    |

### Selection and Highlights

| Token           | Required | Controls                                                                                              |
| --------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `--sel`         | Yes      | Selected tree row, search result line, outline symbol, palette row, native text selection, whole-file selection (Ctrl+A).            |
| `--mark`        | Yes      | Background of search and find matches.                                                                |
| `--mark-active` | Yes      | Current find match, minimap match ticks, pulsing LSP dot while starting or indexing, search warnings. |
| `--cur`         | Yes      | Current line background, including its gutter cell.                                                   |

Text in ordinary matches keeps its syntax colour on top of `--mark`, so make `--mark` translucent or dark enough that every syntax token stays readable on it. The current match ignores syntax colours and uses `--on-mark-active` instead, so `--mark-active` can be a bright solid colour. It also colours minimap ticks and warnings, so it needs to stand out against `--bg`.

### Elevation and Overlays

| Token         | Required | Fallback                         | Controls                                                                                                          |
| ------------- | -------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `--shadow`    | Yes      | none                             | Large floating surfaces: hover card, find bar, palette, shortcut sheet, image preview. A full `box-shadow` value. |
| `--shadow-sm` | No       | `0 6px 20px rgba(0, 0, 0, 0.28)` | Toast. A full `box-shadow` value.                                                                                 |
| `--scrim`     | No       | `rgba(0, 0, 0, 0.45)`            | Backdrop behind the palette and the shortcut sheet.                                                               |

### Contrast Pairs

| Token              | Required | Fallback    | Controls                                                                                                             |
| ------------------ | -------- | ----------- | -------------------------------------------------------------------------------------------------------------------- |
| `--on-accent`      | No       | `#fff`      | Text on an `--accent` fill: hover state of hover card buttons, status bar selection chip.                            |
| `--on-badge`       | No       | `var(--bg)` | Text on coloured badges: symbol kind tags, file extension tags, palette mode chip.                                   |
| `--on-mark-active` | No       | `var(--bg)` | Text of the current find match, drawn on the solid `--mark-active` fill. Light themes usually set it to `var(--fg)`. |

Badges take their fill from other tokens, so `--on-badge` must contrast with all of them:

- Symbol kind tags: `--nf` for functions and methods, `--nc` for classes, structs, interfaces and other types, `--kt` for constants and variables, `--nt` for modules and namespaces, `--dim` for everything else.
- File extension tags in search results: `--dim`.
- Palette mode chip: `--accent`.

File tree dots reuse syntax tokens too: `--nf` for code, `--kt` for data, `--dim` for docs, `--nt` for web files, `--nc` for images, `--faint` for the rest.

### Syntax Highlighting

The server tokenizes files with Chroma and wraps each token in `<i class="...">`. `classFor` in `highlight.go` maps Chroma token types to the short classes below, and each class reads the token of the same name. Plain names (`Name`, `NameEntity`, `NameKeyword`, `NameOperator`, `NameOther`, `NamePseudo`) and whitespace get no class and render in `--fg`.

| Token   | Class | Chroma token types                                                       | Required | Fallback     |
| ------- | ----- | ------------------------------------------------------------------------ | -------- | ------------ |
| `--k`   | `k`   | `Keyword` and all `Keyword*` types except `KeywordType`                  | Yes      | none         |
| `--kt`  | `kt`  | `KeywordType`                                                            | No       | `var(--k)`   |
| `--nf`  | `nf`  | `NameFunction`, `NameFunctionMagic`                                      | Yes      | none         |
| `--nc`  | `nc`  | `NameClass`, `NameNamespace`, `NameException`                            | No       | `var(--nf)`  |
| `--nb`  | `nb`  | `NameBuiltin`, `NameBuiltinPseudo`                                       | No       | `var(--nf)`  |
| `--nv`  | `nv`  | `NameVariable` and all `NameVariable*` types                             | No       | `var(--fg)`  |
| `--no`  | `no`  | `NameConstant`                                                           | No       | `var(--m)`   |
| `--na`  | `na`  | `NameAttribute`                                                          | No       | `var(--nf)`  |
| `--nt`  | `nt`  | `NameTag`                                                                | No       | `var(--k)`   |
| `--nd`  | `nd`  | `NameDecorator`                                                          | No       | `var(--k)`   |
| `--np`  | `np`  | `NameProperty`, `NameLabel`                                              | No       | `var(--fg)`  |
| `--s`   | `s`   | `Literal`, `LiteralDate`, `LiteralOther`, and all `LiteralString*` types | Yes      | none         |
| `--m`   | `m`   | `LiteralNumber` and all `LiteralNumber*` types                           | Yes      | none         |
| `--o`   | `o`   | `Operator`, `OperatorWord`, `OperatorReserved`                           | No       | `var(--fg)`  |
| `--p`   | `p`   | `Punctuation`                                                            | No       | `var(--dim)` |
| `--c`   | `c`   | `Comment` and `Comment*` types except preprocessor; rendered italic      | Yes      | none         |
| `--cp`  | `cp`  | `CommentPreproc`, `CommentPreprocFile`                                   | No       | `var(--k)`   |
| `--err` | `err` | `Error`; rendered with a wavy underline                                  | Yes      | none         |

Markup tokens, used mostly by diff and Markdown lexers:

| Token     | Class | Chroma token types                    | Required | Fallback      | Notes                                      |
| --------- | ----- | ------------------------------------- | -------- | ------------- | ------------------------------------------ |
| `--gi`    | `gi`  | `GenericInserted`                     | No       | `var(--s)`    | Also the LSP dot when the server is ready. |
| `--gi-bg` | `gi`  | `GenericInserted`                     | No       | `transparent` | Background of inserted tokens.             |
| `--gd`    | `gd`  | `GenericDeleted`                      | No       | `var(--err)`  | Also the LSP dot when the server failed.   |
| `--gd-bg` | `gd`  | `GenericDeleted`                      | No       | `transparent` | Background of deleted lines.               |
| none      | `gh`  | `GenericHeading`, `GenericSubheading` | n/a      | n/a           | Uses `--accent-fg`, bold.                  |
| none      | `ge`  | `GenericEmph`                         | n/a      | n/a           | Italic, no colour.                         |
| none      | `gs`  | `GenericStrong`                       | n/a      | n/a           | Bold, no colour.                           |

The hover card signature and fenced code blocks in the Markdown preview use the same tokens, so a theme colours all three surfaces at once.

GitHub alerts in the Markdown preview take their accent from existing tokens: Note `--accent`, Tip `--gi`, Important `--nc`, Warning `--mark-active`, Caution `--err`. Find in the preview marks matches with `--mark` and `--mark-active`, as in the code view.

## Structural Tokens

`web/style.css` defines these in `:root`. They apply to every theme. Change them in `style.css`, not in a theme file: px0 measures character width once at boot, so a font or size that changes when the theme switches leaves the gutter and horizontal scroll width wrong until reload.

| Token    | Default                                              | Controls                                                                                                                  |
| -------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `--mono` | `"JetBrains Mono", "Fira Code", ...`                 | Code, line numbers, palette entries, counters and other fixed-width labels.                                               |
| `--ui`   | `-apple-system, BlinkMacSystemFont, "Segoe UI", ...` | Everything else: tree, tabs, panels, buttons, toast.                                                                      |
| `--fs`   | `13.5px`                                             | Editor and hover card signature font size.                                                                                |
| `--lh`   | `21px`                                               | Editor row height. The virtual scroller also hard-codes a row height as `LH` in `web/src/state.js`; change both together. |

## Rules for Contributors

- Write no literal colour in `web/style.css`. Add a token instead.
- Give every new token a fallback in the `:root` block of `style.css` derived from an existing token, unless no sensible derivation exists. Then add it to every file in `web/themes/`, to the required tables above, and to the `required` list in `TestThemesStylesheetJoinsEveryThemeFile`.
- Document every new token in this file in the same change.
- Check a theme in both states that stress contrast: a search with many matches on the current line, and the palette open over code.

## Troubleshooting

- The theme does not appear in the picker. Check that the file sits directly in `web/themes/`, ends in `.css`, and uses the selector `:root[data-theme="<id>"]` with nothing else in it. Without `-dev`, rebuild the binary: the running one serves its embedded copy.
- Some elements lose their colour. A required token is missing. Compare the theme against the required rows above.
- The old theme comes back after reload. The saved preference is in `localStorage` under `px0.theme`. Pick the theme again, or clear that key.
