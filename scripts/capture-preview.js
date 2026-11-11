'use strict';

// Capture the real app with a generated, non-private sample. No fake UI state.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { locateFfmpeg } = require('../lib/ffmpeg-locate');
const { launch, setStub } = require('../test/e2e/launch');

async function capture() {
  const cleanup = [];
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kinoshift-preview-'));
  const assets = path.join(__dirname, '..', 'docs', 'assets');
  try {
    const binary = await locateFfmpeg();
    if (!binary) throw new Error('FFmpeg is required. Run npm run fetch-ffmpeg first.');
    const sample = path.join(mediaDir, 'weekend-clip.mov');
    const result = spawnSync(binary, ['-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24',
      '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '1',
      '-c:v', 'libx264', '-c:a', 'aac', sample], { encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr);

    const { app, page } = await launch({ after: (fn) => cleanup.push(fn) });
    await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
    await setStub(app, { files: [sample] });
    await page.locator('#dropzone').click();
    await page.locator('#queue li').waitFor();
    await page.locator('#format').selectOption('mp4');
    await page.locator('#advanced summary').click();
    await page.screenshot({ path: path.join(assets, 'kinoshift-app.png'), scale: 'css' });

    const socialPromise = app.waitForEvent('window');
    await app.evaluate(({ BrowserWindow }, file) => {
      const preview = new BrowserWindow({
        width: 1280, height: 640, useContentSize: true, show: false,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      preview.loadFile(file);
    }, path.join(assets, 'social-preview.svg'));
    const social = await socialPromise;
    await social.waitForLoadState('load');
    await social.screenshot({ path: path.join(assets, 'social-preview.png'), scale: 'css' });

    for (const file of ['kinoshift-app.png', 'social-preview.png']) {
      const png = fs.readFileSync(path.join(assets, file));
      console.log(`${file}: ${png.readUInt32BE(16)}x${png.readUInt32BE(20)}, ${png.length} bytes`);
    }
  } finally {
    for (const fn of cleanup.reverse()) await fn();
    fs.rmSync(mediaDir, { recursive: true, force: true });
  }
}

capture().catch((error) => { console.error(error); process.exitCode = 1; });