package main

import (
	"fmt"
	"io"
	"os"
	"strings"
)

// Ape-style 256-color palette
const (
	colorAccent = "208" // amber
	colorOk     = "71"  // muted green
	colorErr    = "167" // muted red
	colorWarn   = "179" // muted amber-yellow
	colorInfo   = "110" // muted blue
	colorDim    = "245" // dim grey
	colorFaint  = "240" // faint grey
)

var (
	uiForcedColor *bool
	uiQuiet       = false
)

func colorEnabled(w io.Writer) bool {
	if uiForcedColor != nil {
		return *uiForcedColor
	}
	if v, exists := os.LookupEnv("NO_COLOR"); exists && v != "" {
		return false
	}
	if v, exists := os.LookupEnv("FORCE_COLOR"); exists {
		return v != "0" && v != "false"
	}
	if os.Getenv("TERM") == "dumb" {
		return false
	}
	return isTTY(w)
}

func paint(text string, code string, bold bool, w io.Writer) string {
	if text == "" || !colorEnabled(w) {
		return text
	}
	prefix := ""
	if bold {
		prefix = "\033[1m"
	}
	return fmt.Sprintf("%s\033[38;5;%sm%s\033[0m", prefix, code, text)
}

func uiDim(t string, w io.Writer) string    { return paint(t, colorDim, false, w) }
func uiFaint(t string, w io.Writer) string  { return paint(t, colorFaint, false, w) }
func uiAccent(t string, w io.Writer) string { return paint(t, colorAccent, false, w) }
func uiStrong(t string, w io.Writer) string {
	if colorEnabled(w) {
		return "\033[1m" + t + "\033[0m"
	}
	return t
}

func uiGlyph(role string, w io.Writer) string {
	tty := isTTY(w)
	var mark, fallback, code string
	switch role {
	case "ok":
		mark, fallback, code = "✓", "[OK]", colorOk
	case "err":
		mark, fallback, code = "✗", "[FAIL]", colorErr
	case "warn":
		mark, fallback, code = "!", "[WARN]", colorWarn
	case "info":
		mark, fallback, code = "·", "[INFO]", colorInfo
	case "step":
		mark, fallback, code = "›", ">", colorAccent
	default:
		mark, fallback, code = "·", "[INFO]", colorInfo
	}
	s := mark
	if !tty {
		s = fallback
	}
	return paint(s, code, false, w)
}

func uiStatus(role, msg, detail string, width int, w io.Writer) {
	if uiQuiet {
		return
	}
	padded := msg
	if width > 0 && len(msg) < width {
		padded = msg + strings.Repeat(" ", width-len(msg))
	}
	line := fmt.Sprintf("%s %s", uiGlyph(role, w), padded)
	if detail != "" {
		line += fmt.Sprintf("  %s", uiDim(detail, w))
	}
	fmt.Fprintln(w, line)
}

func uiHeading(title string, count *int, w io.Writer) {
	if uiQuiet {
		return
	}
	fmt.Fprintln(w)
	line := uiStrong(title, w)
	if count != nil {
		line += fmt.Sprintf(" %s", uiDim(fmt.Sprintf("(%d)", *count), w))
	}
	fmt.Fprintln(w, line)
}

func uiKV(label, value string, width int, w io.Writer) {
	if uiQuiet {
		return
	}
	labelText := label + ":"
	if width > 0 && len(labelText) < width {
		labelText = labelText + strings.Repeat(" ", width-len(labelText))
	}
	fmt.Fprintf(w, "  %s %s\n", uiDim(labelText, w), value)
}

func uiHint(text string, w io.Writer) {
	if uiQuiet {
		return
	}
	fmt.Fprintln(w)
	fmt.Fprintln(w, uiDim(text, w))
}

func uiCommand(text string, w io.Writer) {
	if uiQuiet {
		return
	}
	fmt.Fprintf(w, "  %s\n", uiAccent(text, w))
}

func uiBullet(text string, w io.Writer) {
	if uiQuiet {
		return
	}
	fmt.Fprintf(w, "  %s %s\n", uiFaint("·", w), text)
}
