# Kinoshift v1.0.0 Beta — free, offline video and audio conversion

Welcome to the first public beta release of Kinoshift.

Kinoshift is a free, open-source video and audio converter for macOS and Windows. Convert to MP4, extract MP3 audio from video, or make an animated GIF through a desktop FFmpeg GUI. Your media stays on your computer: no cloud uploads or conversion account required.

**[Download the beta](https://github.com/antinmaze/kinoshift/releases)** · **[See the project and screenshot](https://github.com/antinmaze/kinoshift)** · **[Website](https://antoinemaze.fr/kinoshift/)**

## Why Kinoshift?

- Convert media locally without uploading files to a cloud service
- Keep the process simple and fast for everyday use
- Use a familiar desktop experience built with Electron
- Work with FFmpeg without managing complicated conversion commands manually
- Keep your content private by processing files on-device

## What is included

- macOS DMG installer for Apple Silicon and Intel Macs
- Windows x64 installer
- FFmpeg integration for local media conversion
- Simple conversion presets for common output needs
- Queue-based processing for batch media jobs
- MP4/H.264, WebM/VP9, MKV, MP3, AAC/M4A, WAV, FLAC, OGG, and animated GIF output
- Device presets, trim controls, quality settings, and audio extraction
- English and French interface and help

## Important notes

This is a beta release, which means it is still being validated and may contain rough edges, bugs, or limitations. We are publishing it early to gather feedback and improve the project before broader adoption.

- Updated macOS installers use ad-hoc signing to fix the invalid bundle signature in the original downloads. If you downloaded an earlier DMG, download it again and replace the old application.
- macOS Developer ID signing and notarization are not configured yet. Gatekeeper may still block the application; ad-hoc signing does not establish developer trust.
- Windows code signing is not configured yet
- Operating systems may display security warnings when opening the installer

## Feedback and support

We welcome bug reports, suggestions, and ideas for improvements.

Please open an issue on GitHub to report problems, request features, or share your experience using Kinoshift.

## License

Kinoshift is distributed under the GPL-3.0-or-later license.

Thank you for trying Kinoshift and helping shape the first public beta.

If the app is useful to you, consider starring the repository or sharing a real conversion example. Feedback from testing on macOS and Windows is especially valuable during the beta.

## Short launch copy for maintainers

Adapt this copy to the community's rules and disclose authorship. Do not post it automatically or repeatedly.

> I built Kinoshift, a free, open-source FFmpeg GUI for macOS and Windows. It converts video, extracts MP3 audio, and makes GIFs locally—no media uploads or account. It includes a sequential batch queue, device presets, and an English/French interface. The first public beta is available; macOS builds are not notarized and Windows installers are unsigned. I'd appreciate feedback on installation and everyday conversion workflows: https://github.com/antinmaze/kinoshift
