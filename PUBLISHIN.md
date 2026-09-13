# Publishing Guide for px0

This document outlines the step-by-step instructions for preparing, testing, and publishing a new release of `px0`.

---

## Prerequisites

Before cutting a new release, make sure you have:

- **Git** with push access to the repository (`px0-ai/px0`).
- **Go** (version 1.24+ recommended).
- **Node.js** (v18+ or v20+ recommended) for bundling frontend assets.
- A clean working tree with all desired features/fixes committed.

---

## Pre-Release Verification

Run the test suite and verify that the assets bundle cleanly:

```bash
# 1. Run tests and asset bundling
make test

# 2. Build local binary and verify sanity
make build
./px0 --version
```

---

## Method 1: Automated Release via Makefile (Recommended)

The project includes an automated `make publish` target in the [Makefile](file:///home/arpit/workspace/px0/px0/Makefile) that:
1. Updates the [VERSION](file:///home/arpit/workspace/px0/px0/VERSION) file.
2. Bundles web assets and compiles cross-platform binaries into `dist/`.
3. Commits `VERSION` and `dist/`.
4. Creates an annotated Git tag `v<version>`.

### Step 1: Run the publish command

Specify the desired version (semver format without leading `v`):

```bash
make publish 0.2.0
```

### Step 2: Push commit and tag to GitHub

Push the commit and tag to remote to trigger the GitHub Actions release workflow:

```bash
git push origin master --tags
```

---

## Method 2: Manual Release via Git

If you prefer to perform the release steps manually:

1. **Update `VERSION` file**:
   ```bash
   echo "0.2.0" > VERSION
   ```

2. **Bundle frontend assets & compile binaries**:
   ```bash
   make dist
   ```

3. **Commit the version bump and build artifacts**:
   ```bash
   git add VERSION dist/
   git commit -m "Release v0.2.0"
   ```

4. **Tag the release**:
   ```bash
   git tag -fa v0.2.0 -m "Release v0.2.0"
   ```

5. **Push to GitHub**:
   ```bash
   git push origin master
   git push origin v0.2.0
   ```

---

## Method 3: Triggering via GitHub Actions (Workflow Dispatch)

If you have already pushed changes or want GitHub Actions to compile and create the release automatically:

1. Navigate to **Actions** → **Release** workflow on GitHub:
   `https://github.com/px0-ai/px0/actions/workflows/release.yml`
2. Click **Run workflow**.
3. Provide the version tag (e.g. `v0.2.0`).
4. Run the workflow.

The GitHub Actions workflow will:
- Bundle frontend assets (`scripts/build-web.js`).
- Build binaries for all supported platforms (`linux`, `darwin`, `windows`, `freebsd`, `openbsd`, `netbsd`).
- Compute SHA256 checksums (`dist/checksums.txt`).
- Publish a new GitHub Release with generated release notes and attachments.

---

## Post-Release Checklist

1. Check the GitHub Actions run under the **Actions** tab to ensure the build succeeded.
2. Visit the [Releases](https://github.com/px0-ai/px0/releases) page to verify:
   - Release notes are generated accurately.
   - Cross-platform binaries and `checksums.txt` are attached.
3. Test installation via the install script:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/px0-ai/px0/master/install.sh | sh
   ```
4. Test self-update in `px0` (if installed from previous version):
   ```bash
   px0 update
   ```
