# Contributing to Kinoshift

Thanks for helping make local media conversion more accessible. Bug reports, documentation fixes, translations, accessibility improvements, and code contributions are welcome.

## Report a bug or propose a feature

Search [existing issues](https://github.com/antinmaze/kinoshift/issues) first, then use the bug report or feature request form. Include your Kinoshift version, operating system, processor architecture, preset, and steps to reproduce. Never attach private media or logs containing sensitive paths; use a small, shareable sample when possible.

For significant changes, open an issue before implementation so the scope can be discussed. There is no guarantee of acceptance or a response deadline.

## Run locally

Use Node.js 22.12 or newer and npm on macOS or Windows. From the repository root:

```bash
npm ci
npm run fetch-ffmpeg
npm start
```

## Test your changes

The full static checks expect FFmpeg resources for all supported platforms:

```bash
npm run fetch-ffmpeg -- all
npm test
npm run test:e2e
```

The UI tests launch real Electron windows. For metadata and documentation-only checks, run:

```bash
node --test test/discoverability.test.js
```

## Find a useful contribution

- Reproduce a reported conversion problem using a small, non-private media sample.
- Improve English or French wording in the interface and help pages together.
- Test keyboard navigation, contrast, or behavior on a supported operating system.
- Add regression tests for edge cases involving media, filenames, and presets.
- Improve installation instructions or contribute a clear real-world example.

Look for [`good first issue`](https://github.com/antinmaze/kinoshift/labels/good%20first%20issue) or [`help wanted`](https://github.com/antinmaze/kinoshift/labels/help%20wanted) labels when maintainers have identified suitable tasks. These queues may be empty; unclaimed work is not automatically beginner-friendly.

## Submit a pull request

1. Fork the repository and create a focused branch.
2. Keep changes scoped to one problem; avoid unrelated formatting or dependency updates.
3. Add or update tests when behavior changes.
4. Write the title, description, and commit messages in English.
5. Explain the problem, solution, tests actually run, and relevant limitations. Include screenshots for visual changes.

Do not claim tests passed if they were not run. Contributions are distributed under the project's [GPL-3.0-or-later license](LICENSE). Be respectful, constructive, and mindful of other contributors' time.