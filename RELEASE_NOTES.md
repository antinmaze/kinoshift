# Kinoshift v1.0.0

Welcome to the first public beta release of Kinoshift.

Kinoshift is an open-source audio and video converter for macOS and Windows, built with Electron and FFmpeg. It keeps media processing local to the user's machine and provides a lightweight desktop workflow for common file conversion tasks.

## Highlights

- Local conversion without cloud uploads
- FFmpeg-backed processing pipeline
- Desktop app for macOS and Windows
- Simple preset-based conversion flow
- Support for queued media files and output folder selection
- Open-source project distributed under GPL-3.0-or-later

## Included in this release

- macOS DMG installer for Apple Silicon and Intel Macs
- Windows x64 installer
- Local FFmpeg packaging for the build output

## Requirements

- macOS 12+ or Windows 10/11 x64
- Sufficient free disk space for the build output and converted media

## Notes

- This is a beta release and may contain bugs or functional limitations.
- macOS signing and notarization are not yet configured.
- Windows code signing is not yet configured.
- Opening the downloaded installer may trigger a security warning from the OS.

## Known limitations

- Some advanced conversion profiles may require manual FFmpeg setup or a valid local binary.
- The installer is provided as-is for beta testing and feedback.

## Feedback

Please report bugs, issues, and feature suggestions in the GitHub issue tracker.

## License

This project is licensed under the GPL-3.0-or-later license.
