'use strict';

// Repository settings are separate from package.json. Keep the public About
// description, homepage, and discovery topics reproducible through GitHub CLI.
const { spawnSync } = require('node:child_process');
const metadata = require('../.github/repository-metadata.json');

function gh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `gh exited with ${result.status}`);
  return result.stdout;
}

try {
  const mode = process.argv.slice(2);
  if (mode.length !== 1 || !['--check', '--apply'].includes(mode[0])) {
    throw new Error('Usage: node scripts/github-metadata.js --check|--apply (requires authenticated gh)');
  }
  if (mode[0] === '--apply') {
    gh(['repo', 'edit', metadata.repository, '--description', metadata.description,
      '--homepage', metadata.homepage, ...metadata.topics.flatMap((topic) => ['--add-topic', topic])]);
  }
  const actual = JSON.parse(gh(['repo', 'view', metadata.repository,
    '--json', 'description,homepageUrl,repositoryTopics']));
  const topics = new Set((actual.repositoryTopics || []).map((topic) => topic.name));
  const missing = metadata.topics.filter((topic) => !topics.has(topic));
  if (actual.description !== metadata.description || actual.homepageUrl !== metadata.homepage || missing.length) {
    throw new Error(`GitHub metadata differs from configuration. Missing topics: ${missing.join(', ') || 'none'}. Run npm run github:sync to apply.`);
  }
  console.log(`Verified description, homepage, and ${metadata.topics.length} discovery topics for ${metadata.repository}.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}