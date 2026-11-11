# Kinoshift discoverability playbook

## What these changes can and cannot do

Clear repository metadata, useful documentation, real screenshots, and a working download improve discovery and help visitors decide whether to try or star a project. No configuration guarantees search position, GitHub Trending placement, or a number of stars. Package keywords do not automatically become GitHub topics. Website SEO and GitHub's repository search are separate systems.

Keep the README in English for broad accessibility, with a short French explanation reflecting the actual localized interface. Use relevant terms in natural sentences, not repeated keyword lists. Never fabricate users, reviews, benchmarks, ratings, or endorsements.

## Repository configuration

The source of truth for the About description, homepage, and 20 relevant GitHub topics is [repository-metadata.json](repository-metadata.json). GitHub allows at most 20 topics. An authenticated repository maintainer can apply and verify this configuration from the repository root:

```bash
npm run github:sync
npm run github:check
```

The sync adds the configured topics without deliberately removing other topics. Review any existing topics before adding more: the total cannot exceed 20.

### Manual GitHub settings

- **Settings → General → Social preview:** upload [the 1280 × 640 PNG](../docs/assets/social-preview.png). Website Open Graph tags do not configure GitHub's own repository social preview. This upload is a separate manual setting.
- **Settings → Pages:** publish the main branch's `/docs` folder. Keep the homepage and canonical URL aligned with the actual public address.
- Pin Kinoshift on the maintainer's GitHub profile if it is a priority project.
- Keep releases easy to find, with architecture-specific artifacts and honest signing/notarization warnings. The current release is a beta: links deliberately use `/releases`, not `/releases/latest`, which can exclude pre-releases.
- Apply `good first issue` and `help wanted` labels only to genuine, scoped tasks. Do not manufacture activity or populate empty promises.

## Website indexing and sharing

The site includes a canonical URL, Open Graph/Twitter cards, real app imagery, a sitemap, and SoftwareApplication structured data. It intentionally has no invented `aggregateRating` or review schema. Structured data does not guarantee a rich search result.

Submit `https://antoinemaze.fr/kinoshift/sitemap.xml` in Google Search Console and Bing Webmaster Tools using verified ownership. Request indexing of the landing page after publication. This repository owns a **subpath**: a crawler policy belongs at the domain root, not at `/kinoshift/robots.txt`. If you control the domain's root robots.txt, add the sitemap URL there without overwriting rules for other projects. Check that the root policy does not block `/kinoshift/`.

Regenerate both screenshots from the actual Electron app using a synthetic, non-private media sample:

```bash
npm run docs:screenshots
```

This opens Electron and requires the installed development dependencies and a working FFmpeg. The editable social card source is [social-preview.svg](../docs/assets/social-preview.svg). Review visual assets after regeneration.

## Organic launch plan

### Before sharing

- Test installers on the supported architectures where possible; state what has actually been tested.
- Publish a short 20–40 second demo: add a sample, choose MP4 or MP3, convert, show the result.
- Check the README, download links, signing warnings, and website on mobile.
- Pin a concise release announcement with a specific use case and known beta limitations.

### First week

- Post once to relevant communities that permit project showcases: FFmpeg/Electron communities, macOS or Windows software forums, and open-source media communities. Read each community's rules first.
- Lead with a real task (for example, extracting MP3 audio locally), not “please star my repo.” Disclose that you are the author.
- Consider a Show HN or a GitHub discussion in an appropriate community once the demo and downloads are reliable. Do not post duplicate submissions or coordinate votes.
- Submit to curated software directories or relevant awesome lists only when the project meets their requirements. Tailor every submission and disclose affiliation. Do not create unsolicited promotional PRs at scale.
- Use [the launch copy](../RELEASE_ANNOUNCEMENT.md) as a starting point, not an identical message to paste everywhere.

### Following weeks

- Reply to real bug reports and publish fixes with concise release notes.
- Share useful examples such as MOV → MP4, video → MP3, or video → GIF when a release makes them better.
- Publish compatibility findings and limitations; do not claim “faster,” “smaller,” or “best” without reproducible evidence.
- Track weekly repository visitors, clones, referral sources, and release downloads using GitHub's available traffic and release data. Traffic history is short-lived; record snapshots if needed.
- Compare interest after each meaningful release, not after cosmetic keyword changes. No invasive analytics or tracking parameters are necessary for the app.

Never buy stars, trade stars, use bots, mass-message users, or imply official affiliation with FFmpeg or device manufacturers. Sustainable interest depends on useful software, trustworthy downloads, and responsive maintenance.