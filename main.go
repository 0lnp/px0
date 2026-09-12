package main

import (
	"context"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
)

var version = "0.1.0"

func main() {
	var (
		port    = flag.Int("port", 7777, "port to listen on (0 picks a free one)")
		host    = flag.String("host", "127.0.0.1", "address to bind")
		noOpen  = flag.Bool("no-open", false, "do not launch a browser")
		noLSP   = flag.Bool("no-lsp", false, "do not use language servers, even if installed")
		dev     = flag.String("dev", "", "serve the UI from this source directory instead of the embedded copy")
		showVer = flag.Bool("version", false, "print version and exit")
	)
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "px0 %s - a code navigator\n\nusage: px0 [flags] [directory]\n\nflags:\n", version)
		flag.PrintDefaults()
	}
	flag.Parse()

	if *showVer {
		fmt.Printf("px0 %s (%s/%s)\n", version, runtime.GOOS, runtime.GOARCH)
		return
	}

	if *dev != "" {
		if err := useDiskAssets(*dev); err != nil {
			fatal(fmt.Errorf("-dev %s: %w", *dev, err))
		}
	}

	target := "."
	if flag.NArg() > 0 {
		target = flag.Arg(0)
	}
	root, err := filepath.Abs(target)
	if err != nil {
		fatal(err)
	}
	if st, err := os.Stat(root); err != nil || !st.IsDir() {
		fatal(fmt.Errorf("not a directory: %s", root))
	}
	// Resolve symlinks so the traversal guard compares like with like.
	if resolved, err := filepath.EvalSymlinks(root); err == nil {
		root = resolved
	}

	ln, addr, err := listen(*host, *port)
	if err != nil {
		fatal(err)
	}

	ix := NewIndex(root)
	lsp := newLSPManager(root, !*noLSP)

	srv := &http.Server{Handler: NewServer(ix, lsp)}

	url := "http://" + addr
	fmt.Printf("px0 %s  %s\n", version, root)
	fmt.Printf("  -> %s   (ctrl-c to stop)\n", url)

	// Launch browser immediately without blocking startup.
	if !*noOpen {
		go openBrowser(url)
	}

	// Index workspace asynchronously so the server and UI respond in <1ms.
	go func() {
		ix.Build()
		n, _, ms := ix.Stats()
		fmt.Printf("  indexed %d files in %dms\n", n, ms)
		if names := lsp.Available(); len(names) > 0 {
			fmt.Printf("  language servers: %s (started on first use)\n", strings.Join(names, ", "))
		}
	}()

	// Language servers are children that can hold gigabytes. Shut them down on
	// the way out rather than leaving them for the OS to reap.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-stop
		fmt.Print("\r")
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		srv.Shutdown(ctx)
		lsp.Close()
		os.Exit(0)
	}()

	if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
		lsp.Close()
		fatal(err)
	}
	lsp.Close()
}

// listen binds the requested port, walking forward if it is already taken so a
// second instance does not simply fail.
func listen(host string, port int) (net.Listener, string, error) {
	if port == 0 {
		ln, err := net.Listen("tcp", net.JoinHostPort(host, "0"))
		if err != nil {
			return nil, "", err
		}
		return ln, ln.Addr().String(), nil
	}
	for p := port; p < port+20; p++ {
		addr := net.JoinHostPort(host, fmt.Sprint(p))
		if ln, err := net.Listen("tcp", addr); err == nil {
			return ln, addr, nil
		}
	}
	return nil, "", fmt.Errorf("no free port in range %d-%d", port, port+20)
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "px0:", err)
	os.Exit(1)
}
