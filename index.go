package main

import (
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

type FileEntry struct {
	Path      string `json:"path"` // slash-separated, relative to root
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	lower     string // cached lowercase Path for matching
	nameStart int    // index in Path where the basename begins
}

type Node struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Dir  bool   `json:"dir"`
	Size int64  `json:"size"`
}

type Index struct {
	root string

	mu       sync.RWMutex
	files    []FileEntry
	children map[string][]Node
	builtAt  time.Time
	buildMS  int64
}

func NewIndex(root string) *Index {
	return &Index{root: root, children: map[string][]Node{}}
}

func (ix *Index) Root() string { return ix.root }

func (ix *Index) Stats() (files int, builtAt time.Time, ms int64) {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	return len(ix.files), ix.builtAt, ix.buildMS
}

func (ix *Index) Files() []FileEntry {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	return ix.files
}

func (ix *Index) Children(dir string) ([]Node, bool) {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	c, ok := ix.children[dir]
	return c, ok
}

// Build walks the tree once, honouring .gitignore at every level, and
// materialises both the flat file list (for fuzzy find and search) and the
// directory map (for the tree view).
func (ix *Index) Build() {
	start := time.Now()
	root := newIgnoreSet(nil)
	root = root.child(readGitignore(ix.root, ""))

	var (
		mu       sync.Mutex
		files    []FileEntry
		children = map[string][]Node{}
		wg       sync.WaitGroup
		sem      = make(chan struct{}, runtime.NumCPU()*4)
	)

	var walk func(abs, rel string, ig *ignoreSet)
	walk = func(abs, rel string, ig *ignoreSet) {
		defer wg.Done()
		ents, err := os.ReadDir(abs)
		if err != nil {
			return
		}
		if rel != "" {
			if extra := readGitignore(abs, rel); len(extra) > 0 {
				ig = ig.child(extra)
			}
		}
		kids := make([]Node, 0, len(ents))
		var subdirs []struct {
			abs, rel string
		}
		for _, e := range ents {
			name := e.Name()
			childRel := name
			if rel != "" {
				childRel = rel + "/" + name
			}
			isDir := e.IsDir()
			// Follow nothing through symlinks; cycles are not worth the risk.
			if e.Type()&os.ModeSymlink != 0 {
				continue
			}
			if ig.match(childRel, isDir) {
				continue
			}
			if isDir {
				kids = append(kids, Node{Name: name, Path: childRel, Dir: true})
				subdirs = append(subdirs, struct{ abs, rel string }{filepath.Join(abs, name), childRel})
				continue
			}
			info, err := e.Info()
			if err != nil {
				continue
			}
			kids = append(kids, Node{Name: name, Path: childRel, Size: info.Size()})
			mu.Lock()
			files = append(files, FileEntry{
				Path: childRel, Name: name, Size: info.Size(),
				lower: strings.ToLower(childRel), nameStart: len(childRel) - len(name),
			})
			mu.Unlock()
		}
		sort.Slice(kids, func(i, j int) bool {
			if kids[i].Dir != kids[j].Dir {
				return kids[i].Dir
			}
			return strings.ToLower(kids[i].Name) < strings.ToLower(kids[j].Name)
		})
		mu.Lock()
		children[rel] = kids
		mu.Unlock()

		for _, sd := range subdirs {
			wg.Add(1)
			select {
			case sem <- struct{}{}:
				go func(a, r string, g *ignoreSet) {
					defer func() { <-sem }()
					walk(a, r, g)
				}(sd.abs, sd.rel, ig)
			default:
				walk(sd.abs, sd.rel, ig) // pool saturated: recurse inline
			}
		}
	}

	wg.Add(1)
	walk(ix.root, "", root)
	wg.Wait()

	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })

	ix.mu.Lock()
	ix.files, ix.children = files, children
	ix.builtAt, ix.buildMS = time.Now(), time.Since(start).Milliseconds()
	ix.mu.Unlock()
}
