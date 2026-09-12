package main

import (
	"context"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// lspServerDef describes one language server we know how to drive. Nothing here
// is required for px0 to work; a server is used only if its binary happens to
// be on PATH.
type lspServerDef struct {
	Name        string
	Cmd         []string
	Exts        []string          // file extensions this server handles
	LangIDs     map[string]string // ext -> LSP languageId, when it differs
	DefaultLang string
	InitOptions map[string]any
}

func (d lspServerDef) LanguageID(rel string) string {
	ext := strings.ToLower(filepath.Ext(rel))
	if id, ok := d.LangIDs[ext]; ok {
		return id
	}
	return d.DefaultLang
}

// lspRegistry is ordered: the first entry whose binary exists wins for a given
// extension, so a more capable server listed earlier takes precedence.
var lspRegistry = []lspServerDef{
	{
		Name: "gopls", Cmd: []string{"gopls"},
		Exts: []string{".go"}, DefaultLang: "go",
	},
	{
		Name: "rust-analyzer", Cmd: []string{"rust-analyzer"},
		Exts: []string{".rs"}, DefaultLang: "rust",
	},
	{
		Name: "pyright", Cmd: []string{"pyright-langserver", "--stdio"},
		Exts: []string{".py", ".pyi"}, DefaultLang: "python",
	},
	{
		Name: "pylsp", Cmd: []string{"pylsp"},
		Exts: []string{".py", ".pyi"}, DefaultLang: "python",
	},
	{
		Name: "ruff", Cmd: []string{"ruff", "server"},
		Exts: []string{".py"}, DefaultLang: "python",
	},
	{
		Name: "typescript", Cmd: []string{"typescript-language-server", "--stdio"},
		Exts:        []string{".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"},
		LangIDs:     map[string]string{".ts": "typescript", ".tsx": "typescriptreact", ".jsx": "javascriptreact"},
		DefaultLang: "javascript",
	},
	{
		Name: "clangd", Cmd: []string{"clangd", "--background-index"},
		Exts:        []string{".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh", ".m", ".mm"},
		LangIDs:     map[string]string{".c": "c", ".h": "c"},
		DefaultLang: "cpp",
	},
	{
		Name: "zls", Cmd: []string{"zls"},
		Exts: []string{".zig"}, DefaultLang: "zig",
	},
	{
		Name: "lua", Cmd: []string{"lua-language-server"},
		Exts: []string{".lua"}, DefaultLang: "lua",
	},
	{
		Name: "solargraph", Cmd: []string{"solargraph", "stdio"},
		Exts: []string{".rb"}, DefaultLang: "ruby",
	},
	{
		Name: "jdtls", Cmd: []string{"jdtls"},
		Exts: []string{".java"}, DefaultLang: "java",
	},
	{
		Name: "omnisharp", Cmd: []string{"omnisharp", "-lsp"},
		Exts: []string{".cs"}, DefaultLang: "csharp",
	},
	{
		Name: "texlab", Cmd: []string{"texlab"},
		Exts: []string{".tex"}, DefaultLang: "latex",
	},
}

// ---------------------------------------------------------------- manager

type lspState string

const (
	lspOff      lspState = "off"      // disabled, or no server installed for this type
	lspStarting lspState = "starting" // process spawned, handshake in flight
	lspIndexing lspState = "indexing" // up, but still chewing through the workspace
	lspReady    lspState = "ready"
	lspFailed   lspState = "failed"
)

type lspManager struct {
	root    string
	enabled bool

	mu        sync.Mutex
	byExt     map[string]*lspServerDef // resolved once at startup
	clients   map[string]*lspClient    // server name -> client
	starting  map[string]chan struct{}
	failed    map[string]string
	available []string

	// external holds absolute paths outside the indexed tree that a language
	// server pointed us at. Only these are openable beyond the root, so a
	// jump into the standard library works without opening up the filesystem.
	extMu    sync.Mutex
	external map[string]bool
}

func (m *lspManager) allow(abs string) {
	m.extMu.Lock()
	if m.external == nil {
		m.external = map[string]bool{}
	}
	if len(m.external) < 20000 {
		m.external[abs] = true
	}
	m.extMu.Unlock()
}

// Allowed reports whether a language server has named this exact file.
func (m *lspManager) Allowed(abs string) bool {
	m.extMu.Lock()
	defer m.extMu.Unlock()
	return m.external[abs]
}

func newLSPManager(root string, enabled bool) *lspManager {
	m := &lspManager{
		root: root, enabled: enabled,
		byExt:    map[string]*lspServerDef{},
		clients:  map[string]*lspClient{},
		starting: map[string]chan struct{}{},
		failed:   map[string]string{},
	}
	if !enabled {
		return m
	}
	seen := map[string]bool{}
	for i := range lspRegistry {
		def := &lspRegistry[i]
		if _, err := exec.LookPath(def.Cmd[0]); err != nil {
			continue
		}
		claimed := false
		for _, ext := range def.Exts {
			if m.byExt[ext] == nil {
				m.byExt[ext] = def
				claimed = true
			}
		}
		if claimed && !seen[def.Name] {
			seen[def.Name] = true
			m.available = append(m.available, def.Name)
		}
	}
	return m
}

func (m *lspManager) Available() []string {
	if m.available == nil {
		return []string{}
	}
	return m.available
}

func (m *lspManager) defFor(rel string) *lspServerDef {
	if !m.enabled {
		return nil
	}
	return m.byExt[strings.ToLower(filepath.Ext(rel))]
}

// State reports what a caller can expect for this file without starting
// anything, so the UI can say "indexing" instead of silently showing regex hits.
func (m *lspManager) State(rel string) (lspState, string) {
	def := m.defFor(rel)
	if def == nil {
		return lspOff, ""
	}
	m.mu.Lock()
	c, ok := m.clients[def.Name]
	why, bad := m.failed[def.Name]
	_, pending := m.starting[def.Name]
	m.mu.Unlock()

	switch {
	case bad:
		return lspFailed, why
	case pending:
		return lspStarting, def.Name
	case !ok:
		return lspStarting, def.Name // not spawned yet; the next call will
	case c.alive() != nil:
		return lspFailed, def.Name
	case c.busy():
		return lspIndexing, def.Name
	}
	return lspReady, def.Name
}

// client returns a started client for rel, spawning one on first use. Callers
// that cannot wait should pass a short context; the spawn continues regardless
// so the next request finds it ready.
func (m *lspManager) client(ctx context.Context, rel string) (*lspClient, error) {
	def := m.defFor(rel)
	if def == nil {
		return nil, errNoServer
	}
	for {
		m.mu.Lock()
		if why, bad := m.failed[def.Name]; bad {
			m.mu.Unlock()
			return nil, errFailed{why}
		}
		if c, ok := m.clients[def.Name]; ok {
			m.mu.Unlock()
			if err := c.alive(); err != nil {
				return nil, err
			}
			return c, nil
		}
		if wait, ok := m.starting[def.Name]; ok {
			m.mu.Unlock()
			select {
			case <-wait:
				continue // loop back and pick up the result
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		done := make(chan struct{})
		m.starting[def.Name] = done
		m.mu.Unlock()

		go m.spawn(def, done)

		select {
		case <-done:
			continue
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
}

func (m *lspManager) spawn(def *lspServerDef, done chan struct{}) {
	// The handshake gets a generous budget of its own: some servers do real
	// work before answering initialize.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	c := newLSPClient(*def, m.root)
	err := c.start(ctx)

	m.mu.Lock()
	if err != nil {
		m.failed[def.Name] = err.Error()
	} else {
		m.clients[def.Name] = c
	}
	delete(m.starting, def.Name)
	m.mu.Unlock()
	close(done)
}

func (m *lspManager) Close() {
	m.mu.Lock()
	clients := make([]*lspClient, 0, len(m.clients))
	for _, c := range m.clients {
		clients = append(clients, c)
	}
	m.clients = map[string]*lspClient{}
	m.mu.Unlock()
	for _, c := range clients {
		c.shutdown()
	}
}

type errFailed struct{ why string }

func (e errFailed) Error() string { return e.why }

var errNoServer = errFailed{"no language server for this file type"}
