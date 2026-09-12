package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCompareSemver(t *testing.T) {
	tests := []struct {
		v1   string
		v2   string
		want int
	}{
		{"0.1.0", "0.1.0", 0},
		{"v0.1.0", "0.1.0", 0},
		{"0.1.0", "v0.1.0", 0},
		{"0.2.0", "0.1.0", 1},
		{"0.1.0", "0.2.0", -1},
		{"1.0.0", "0.9.9", 1},
		{"0.1.1", "0.1.0", 1},
		{"0.10.0", "0.9.0", 1},
		{"0.1.0-alpha", "0.1.0", 0},
		{"0.2.0", "0.1.99", 1},
	}

	for _, tt := range tests {
		got := compareSemver(tt.v1, tt.v2)
		if got != tt.want {
			t.Errorf("compareSemver(%q, %q) = %d, want %d", tt.v1, tt.v2, got, tt.want)
		}
	}
}

func TestFetchLatestRelease(t *testing.T) {
	fakeRelease := githubRelease{
		TagName: "v0.2.0",
		Name:    "px0 v0.2.0",
		Assets: []struct {
			Name               string `json:"name"`
			BrowserDownloadURL string `json:"browser_download_url"`
		}{
			{
				Name:               "px0-0.2.0-linux-amd64",
				BrowserDownloadURL: "https://example.com/download/px0",
			},
		},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(fakeRelease)
	}))
	defer server.Close()

	t.Setenv("PX0_UPDATE_URL", server.URL)

	rel, err := fetchLatestRelease("test/repo")
	if err != nil {
		t.Fatalf("fetchLatestRelease failed: %v", err)
	}

	if rel.TagName != "v0.2.0" {
		t.Errorf("got TagName %q, want v0.2.0", rel.TagName)
	}
	if len(rel.Assets) != 1 || rel.Assets[0].Name != "px0-0.2.0-linux-amd64" {
		t.Errorf("unexpected assets: %+v", rel.Assets)
	}
}

func TestUpdateStatePersistence(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", tmpDir)

	statePath := filepath.Join(tmpDir, "px0", "update_check.json")
	if _, err := os.Stat(statePath); !os.IsNotExist(err) {
		t.Fatalf("expected state file to not exist yet")
	}

	now := time.Now().Truncate(time.Second)
	s := &updateState{
		LastChecked: now,
		LatestVer:   "0.2.0",
	}
	writeUpdateState(s)

	readState, err := readUpdateState()
	if err != nil {
		t.Fatalf("readUpdateState failed: %v", err)
	}

	if readState.LatestVer != "0.2.0" {
		t.Errorf("read LatestVer = %q, want 0.2.0", readState.LatestVer)
	}
	if readState.LastChecked.Unix() != now.Unix() {
		t.Errorf("read LastChecked = %v, want %v", readState.LastChecked, now)
	}
}
