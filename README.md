# Kinoshift

Kinoshift is an open-source audio and video converter for macOS and Windows. Built with Electron and FFmpeg, it processes media locally on your machine without requiring a cloud service.

> Beta release: the application is still under validation and may contain bugs or functional limitations.

## About

Kinoshift carries forward the spirit of Miro Video Converter 3 in a modern, compact, and maintainable form. The goal is to provide a practical and lightweight conversion tool for common media formats without unnecessary complexity.

This project is distributed under the GPL-3.0-or-later license.

## Features

- Local audio and video conversion
- Built-in conversion presets
- Automatic FFmpeg detection
- Manual FFmpeg binary selection
- Desktop Electron interface
- Support for macOS and Windows
- Automated unit, integration, and E2E tests

## Requirements

- Node.js 22.12 or newer
- npm
- macOS (Apple Silicon or Intel) or Windows x64

## Development setup

```bash
npm install
npm run fetch-ffmpeg
npm start
```

### FFmpeg

FFmpeg binaries are not stored in the repository. In development, the app can also detect an installed FFmpeg or use a manually selected path. The provided script downloads the binaries and validates the SHA-256 hash of each archive:

```bash
npm run fetch-ffmpeg
```

To download binaries for multiple platforms:

```bash
npm run fetch-ffmpeg -- all
```

## Tests

The full test suite requires FFmpeg binaries for the supported platforms, including build verification. Download them before running the checks:

```bash
npm run fetch-ffmpeg -- all
npm test
npm run test:e2e
npm run test:all
```

- `npm test`: unit and integration tests
- `npm run test:e2e`: Electron UI tests
- `npm run test:all`: full test suite

## Building installers

On macOS:

```bash
npm run dist:mac
```

On Windows:

```bash
npm run dist:win
```

The build scripts download the required FFmpeg executables and generate output in the `dist/` folder. The macOS build targets Apple Silicon and Intel DMG images, while the Windows build targets x64 NSIS installers.

## Release publishing

The project is ready to publish GitHub builds for the macOS and Windows installers.

### Create release notes

Use the release notes in [RELEASE_NOTES.md](RELEASE_NOTES.md) for the initial beta publication.

### Publish from the terminal

```bash
npm install
npm run dist
npm run release:github -- 1.0.0
```

This script will:

- build the macOS and Windows installers
- validate that artifacts exist in `dist/`
- create or update the GitHub release for the given version
- attach the generated `.dmg` and `.exe` files to the release

### Manual GitHub publication

If you prefer to publish manually:

```bash
git tag v1.0.0
git push origin main --tags
gh release create v1.0.0 dist/*.dmg dist/*.exe \
  --title "Kinoshift v1.0.0" \
  --notes-file RELEASE_NOTES.md
```

### Release caveats

- macOS signing and notarization are not configured yet.
- Windows signing is not configured yet.
- Users may see warnings from the operating system when opening the installer files.

## License

This project is published under the [GPL-3.0-or-later](LICENSE) license. The FFmpeg binaries and their bundled dependencies are subject to their own licenses; provenance information is included with the downloaded binaries.

## Contributing

Contributions, bug reports, and feature suggestions are welcome. Before submitting changes, it is recommended to run the local test suite to verify that behavior remains consistent.
