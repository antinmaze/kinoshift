'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const metadata = JSON.parse(read('.github/repository-metadata.json'));
const html = read('docs/index.html');

test('discovery metadata: canonical repository, homepage, description, and relevant topics', () => {
  assert.equal(pkg.homepage, metadata.homepage);
  assert.equal(pkg.repository.url, `https://github.com/${metadata.repository}.git`);
  assert.equal(pkg.bugs.url, `https://github.com/${metadata.repository}/issues`);
  assert.ok(metadata.description.length > 0 && metadata.description.length <= 350);
  assert.ok(metadata.topics.length > 0 && metadata.topics.length <= 20);
  assert.equal(new Set(metadata.topics).size, metadata.topics.length);
  for (const topic of metadata.topics) assert.match(topic, /^[a-z0-9][a-z0-9-]{0,49}$/);
  for (const keyword of ['ffmpeg-gui', 'video-converter', 'audio-converter', 'macos', 'windows']) {
    assert.ok(pkg.keywords.includes(keyword));
    assert.ok(metadata.topics.includes(keyword));
  }
});

test('site metadata: canonical, social previews, sitemap, and truthful software schema', () => {
  assert.ok(html.includes(`<link rel="canonical" href="${metadata.homepage}"`));
  assert.ok(html.includes(`property="og:url" content="${metadata.homepage}"`));
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  const schema = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.equal(schema['@type'], 'SoftwareApplication');
  assert.equal(schema.url, metadata.homepage);
  assert.equal(schema.offers.price, '0');
  assert.equal(schema.isAccessibleForFree, true);
  assert.equal(schema.downloadUrl, `${pkg.repository.url.slice(0, -4)}/releases`);
  assert.equal(schema.aggregateRating, undefined);
  assert.equal(schema.review, undefined);
  assert.ok(read('docs/sitemap.xml').includes(`<loc>${metadata.homepage}</loc>`));
  for (const image of [schema.screenshot, schema.image]) {
    assert.ok(fs.existsSync(path.join(ROOT, 'docs', image.replace(metadata.homepage, ''))));
  }
  const png = fs.readFileSync(path.join(ROOT, 'docs/assets/social-preview.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1280, 640]);
});

test('documentation: local Markdown links and HTML assets resolve inside the repository', () => {
  for (const file of ['README.md', 'CONTRIBUTING.md', '.github/DISCOVERABILITY.md', 'docs/index.html']) {
    const text = read(file);
    const links = [...text.matchAll(/\]\(([^\s)]+)\)/g), ...text.matchAll(/(?:src|href)="([^"]+)"/g)];
    for (const match of links) {
      const target = match[1];
      if (/^(?:https?:|#)/.test(target)) continue;
      const local = decodeURIComponent(target.split('#')[0]);
      assert.ok(fs.existsSync(path.resolve(ROOT, path.dirname(file), local)), `${file} -> ${local}`);
    }
  }
  const readme = read('README.md');
  for (const section of ['Quick start', 'Supported output formats', 'Development setup']) {
    assert.ok(readme.includes(`## ${section}`));
  }
  assert.match(readme, /not Developer ID signed or notarized/);
  assert.match(readme, /sequentially, not in parallel/);
  assert.doesNotMatch(readme, /\/releases\/latest/);
});

test('community entry points: issue forms, contribution guide, and funding exist', () => {
  for (const file of ['CONTRIBUTING.md', '.github/PULL_REQUEST_TEMPLATE.md',
    '.github/ISSUE_TEMPLATE/bug_report.yml', '.github/ISSUE_TEMPLATE/feature_request.yml',
    '.github/ISSUE_TEMPLATE/config.yml', '.github/FUNDING.yml']) {
    assert.ok(read(file).trim().length > 0, file);
  }
});