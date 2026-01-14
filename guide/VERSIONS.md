# Multi-Version Guide Setup

This document explains how the pewpew documentation is structured to support multiple versions.

## Directory Structure

```
pewpew/
├── guide/                    # All guide-related files
│   ├── 0.5.x/               # Stable version (from master branch)
│   │   ├── src/             # Markdown source files
│   │   ├── book.toml        # mdbook config for 0.5.x
│   │   └── results-viewer-react/ # Copy of results viewer (not used)
│   │
│   ├── 0.6.x/               # Preview version (scripting features)
│   │   ├── src/             # Markdown source files
│   │   ├── book.toml        # mdbook config for 0.6.x
│   │   └── results-viewer-react/ # Source for shared results viewer
│   │
│   ├── build-guide.sh      # Build script for local testing
│   ├── serve-guide.sh      # Local server for testing
│   └── VERSIONS.md          # This file
│
└── lib/                     # WASM libraries used by the viewer
    ├── hdr-histogram-wasm/
    └── config-gen/
```

## Deployment Structure

When deployed to GitHub Pages, the structure looks like:

```
https://familysearch.github.io/pewpew/
├── introduction.html         # Stable guide (0.5.x) at root - DEFAULT
├── config.html
├── ...                       # All stable guide pages
├── preview/                  # Preview guide (0.6.x with scripting)
│   ├── introduction.html
│   └── ...
└── viewer/                   # Shared results viewer
    ├── index.html            # Stats viewer
    ├── yaml.html             # YAML test generator
    └── ...
```

**Key Points:**
- The stable 0.5.x guide is at the root (`/pewpew/`) - this is what users see by default
- The preview 0.6.x guide with scripting is at `/pewpew/preview/`
- Both guides link to each other in their introduction pages
- The shared results viewer is at `/pewpew/viewer/`

## Building Locally

### Prerequisites

- Rust toolchain (for wasm-pack)
- Node.js >= 20.0.0
- mdbook (`cargo install mdbook`)
- wasm-pack (`cargo install wasm-pack`)

### Build All Versions

```bash
./guide/build-guide.sh
```

This script:
1. Builds the WASM libraries (hdr-histogram-wasm, config-gen)
2. Builds the results-viewer-react
3. Builds both guide versions (0.5.x and 0.6.x)
4. Assembles everything into `guide/gh-pages-local/` directory

### View Locally

```bash
./guide/serve-guide.sh
```

Then visit: http://localhost:8000

## Deployment to GitHub Pages

The deployment is triggered by pushing the `guide-latest` tag to the `0.6.0-scripting-dev` branch:

```bash
# From the 0.6.0-scripting-dev branch
git tag -f guide-latest
git push origin guide-latest --force
```

The GitHub workflow (`.github/workflows/update-guide.yml`) will:
1. Build both guide versions
2. Build the shared results viewer
3. Assemble the complete structure
4. Deploy to the `gh-pages` branch

## Maintaining Guide Content

### Updating Stable Guide (0.5.x)

The stable guide content comes from the `master` branch. To update it:

1. Make changes in the `master` branch under `guide/`
2. Merge master into `0.6.0-scripting-dev`
3. The merge will update `guide/0.5.x/` automatically via git

### Updating Preview Guide (0.6.x)

The preview guide content is in the `0.6.0-scripting-dev` branch:

1. Make changes directly in `guide/0.6.x/`
2. Commit to `0.6.0-scripting-dev` branch

### Updating Results Viewer

The results viewer is shared between both guide versions:

1. Make changes in `guide/0.6.x/results-viewer-react/`
2. The build process will deploy it to `/viewer/` for both versions to use

## Key Configuration Files

### book.toml Files

Both `guide/0.5.x/book.toml` and `guide/0.6.x/book.toml` are configured with:

- `title`: Different titles to distinguish versions
- `site-url`: Configured for the correct deployment path (`/pewpew/0.5.x/` or `/pewpew/0.6.x/`)
- `build-dir`: Set to `book` for consistent build output

### Linking to the Results Viewer

Both versions link to the shared viewer using absolute paths:

```markdown
[Results Viewer](/pewpew/viewer/index.html)
[HAR to YAML Converter](/pewpew/viewer/yaml.html)
```

This ensures links work correctly when deployed to GitHub Pages.

## Troubleshooting

### Links not working locally

The `/pewpew/` prefix in links is required for GitHub Pages but won't work with a simple file server. The build script assembles everything correctly, so use `./guide/serve-guide.sh` to test.

### Results viewer not loading

Ensure the WASM libraries are built successfully. Check for errors in:
- `lib/hdr-histogram-wasm` build
- `lib/config-gen` build
- `guide/0.6.x/results-viewer-react` npm build

### One guide version is outdated

Remember that `guide/0.5.x` content comes from the `master` branch. You need to:
1. Make changes in master
2. Merge master into scripting-dev
3. Redeploy

## Future Versions

To add a new version (e.g., 0.7.x):

1. Create a new `guide/0.7.x/` directory
2. Update `guide/root-index.html` to add the new version card
3. Update `guide/build-guide.sh` to build the new version
4. Update `.github/workflows/update-guide.yml` to deploy the new version

## Quick Reference

| Task | Command |
|------|---------|
| Build locally | `./guide/build-guide.sh` |
| Test locally | `./guide/serve-guide.sh` |
| Deploy to prod | `git tag -f guide-latest && git push origin guide-latest --force` |
| Edit stable docs | Edit in `master` branch, merge to scripting-dev |
| Edit preview docs | Edit `guide/0.6.x/` in scripting-dev branch |
| Edit viewer | Edit `guide/0.6.x/results-viewer-react/` |
