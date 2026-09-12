---
name: Bug Report
about: Create a detailed report to help us reproduce and resolve an issue
title: "[BUG] "
labels: ["bug"]
assignees: ""
---

### Problem Description
<!-- A clear and concise description of what the bug is. -->

### Environment & System Information
<!-- Tip: Running `px0 -version` prints your px0 version, OS, and Architecture together (e.g., "px0 0.1.0 (linux/amd64)"). -->
- **px0 Version & Architecture**: `px0 -version`
  - Output: <!-- paste output of `px0 -version` here, e.g. px0 0.1.0 (linux/amd64) -->
- **Operating System details**:
  - Linux: `uname -srm` or `cat /etc/os-release`
  - macOS: `sw_vers` or `uname -srm`
  - Windows: `winver` or `systeminfo` / PowerShell: `[System.Environment]::OSVersion`
  - Output: <!-- e.g. Ubuntu 24.04 LTS (x86_64), macOS Sonoma 14.5 (arm64 Apple Silicon) -->
- **Browser & Version**:
  - Chrome / Edge / Brave: Open `chrome://version` or Menu -> Help -> About
  - Firefox: Open `about:support` or Menu -> Help -> About Firefox
  - Safari: Safari -> About Safari
  - Output: <!-- e.g. Chrome 128.0.6613.120, Firefox 130.0 -->
- **Workspace Type & Size**:
  - File count / size: Look at bottom status bar in px0 (e.g. `indexed 4,210 files in 8ms`) or run:
    - Linux/macOS: `find . -type f | wc -l` and `du -sh .`
    - Windows (PowerShell): `(Get-ChildItem -Recurse -File).Count`
  - Primary languages: <!-- e.g. Go, TypeScript, Rust, Python, C++ -->
- **LSP Enabled**: [ ] Yes  [ ] No (`-no-lsp`)

### Steps to Reproduce
1. Run `px0 ...`
2. Open URL in browser: `...`
3. Click on / navigate to `...`
4. Notice that `...`

### Expected Behavior
<!-- A clear and concise description of what you expected to happen. -->

### Actual / Observed Behavior
<!-- What actually happened? (e.g., unexpected error, blank screen, high memory usage, incorrect syntax highlighting, wrong search result). -->

### Console & Terminal Logs
<!-- If applicable, paste terminal output from px0 and/or browser developer console errors (F12 -> Console). -->

```text
Terminal logs or browser console errors here
```

### Visuals / Screenshots / Recordings
<!-- If applicable, attach screenshots or a screen recording showing the issue. -->

### Additional Context
<!-- Any other relevant context, flags used, special file structures, symlinks, or reproduction repositories. -->
