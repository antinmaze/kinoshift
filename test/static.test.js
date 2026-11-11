'use strict';

// Vérifications statiques : traductions, pages HTML (CSP, ressources), sécurité du code, empaquetage, binaires FFmpeg fournis.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const exists = (...p) => fs.existsSync(path.join(ROOT, ...p));

const { LOCALES } = require('../lib/i18n');
const { groups, requiredEncoders } = require('../lib/presets');
const pkg = JSON.parse(read('package.json'));

const SOURCES = ['main.js', 'preload.js', 'lib/menu.js', 'lib/converter.js', 'lib/advanced.js', 'lib/ffmpeg-locate.js', 'lib/theme.js', 'lib/i18n.js', 'lib/presets.js', 'renderer/renderer.js'];
const HTML = ['renderer/index.html', 'renderer/help.fr.html', 'renderer/help.en.html'];
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();

// ---------- Traductions ----------

test('i18n : chaque clé a une valeur non vide, avec les mêmes {paramètres} dans toutes les langues', () => {
  const en = LOCALES.en;
  for (const [lang, messages] of Object.entries(LOCALES)) {
    for (const [key, value] of Object.entries(messages)) {
      assert.equal(typeof value, 'string', `${lang}:${key}`);
      assert.ok(value.trim().length > 0, `${lang}:${key} vide`);
      assert.equal(placeholders(value), placeholders(en[key]), `paramètres de ${key} (${lang})`);
    }
  }
});

test('i18n : toutes les clés utilisées par le code et par index.html existent dans chaque langue', () => {
  const used = new Set();
  for (const file of SOURCES) {
    for (const m of read(file).matchAll(/\bt\(\s*'([\w.-]+)'/g)) used.add(m[1]);
  }
  for (const m of read('renderer/index.html').matchAll(/data-i18n(?:-[a-z-]+)?="([\w.-]+)"/g)) used.add(m[1]);
  // Clés construites dynamiquement.
  for (const g of groups) used.add(`group.${g.id}`);
  for (const id of ['system', 'light', 'dark']) used.add(`menu.theme.${id}`);
  for (const s of ['queued', 'running', 'done', 'error', 'canceled']) used.add(`status.${s}`);
  for (const key of ['err.time.invalid', 'err.time.format', 'err.fps', 'err.size', 'err.quality', 'err.audioTrack', 'err.endBeforeStart', 'err.startAfterEnd', 'err.sampleRate', 'err.unknownFormat', 'err.canceled', 'err.ffmpegFailed']) used.add(key);

  for (const lang of Object.keys(LOCALES)) {
    for (const key of used) assert.ok(key in LOCALES[lang], `clé manquante ${lang}:${key}`);
  }
});

test('i18n : les libellés de préréglage rédigés en français ont une traduction, sans clé orpheline', () => {
  const all = groups.flatMap((g) => g.presets);
  const french = /[àâéèêëîïôùûç]| : | à |récent|animé|ancien/i;
  for (const [lang, messages] of Object.entries(LOCALES)) {
    for (const p of all.filter((x) => french.test(x.label))) assert.ok(`preset.${p.id}` in messages, `preset.${p.id} manquant (${lang})`);
    for (const key of Object.keys(messages).filter((k) => k.startsWith('preset.'))) {
      assert.ok(all.some((p) => `preset.${p.id}` === key), `clé orpheline ${lang}:${key}`);
    }
  }
  for (const key of Object.keys(LOCALES.en).filter((k) => k.startsWith('preset.'))) {
    assert.doesNotMatch(LOCALES.en[key], /[àâéèêëîïôùûç]| : |\bà\b/, `${key} : texte français dans la version anglaise`);
  }
});

test('i18n : aucune clé inutilisée (hors clés dynamiques)', () => {
  const corpus = [...SOURCES, ...HTML].map((f) => read(f)).join('\n');
  const dynamicPrefixes = ['preset.', 'group.', 'menu.theme.', 'status.', 'err.', 'time.'];
  const unused = Object.keys(LOCALES.en).filter((k) => !dynamicPrefixes.some((p) => k.startsWith(p)) && !corpus.includes(`'${k}'`) && !corpus.includes(`"${k}"`));
  assert.deepEqual(unused, []);
});

test('À propos : mentionne la licence, la gratuité et l\'absence de garantie dans chaque langue', () => {
  for (const [lang, m] of Object.entries(LOCALES)) {
    assert.match(m['about.detail'], /GPL/, lang);
    assert.match(m['about.detail'], /\{version\}/, lang);
    assert.match(m['about.detail'], /\{name\}/, lang);
    assert.ok(m['about.detail'].split('\n\n').length >= 3, `${lang} : paragraphes`);
    assert.ok(!m['about.detail'].includes('•'), `${lang} : pas de puces`);
  }
});

// ---------- Pages HTML ----------

test('HTML : CSP stricte, aucun script/style en ligne, aucune ressource distante', () => {
  for (const file of HTML) {
    const html = read(file);
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
    assert.ok(csp, `${file} : CSP absente`);
    assert.match(csp[1], /default-src 'none'/, file);
    assert.doesNotMatch(csp[1], /unsafe-inline|unsafe-eval|\*|https?:|data:/, `${file} : CSP trop permissive`);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, `${file} : script en ligne`);
    assert.doesNotMatch(html, /<style[\s>]/i, `${file} : balise style`);
    assert.doesNotMatch(html, /\sstyle\s*=/i, `${file} : attribut style`);
    assert.doesNotMatch(html, /\son\w+\s*=/i, `${file} : gestionnaire d'événement en ligne`);
    assert.doesNotMatch(html, /(?:src|href)\s*=\s*"(?:https?:)?\/\//i, `${file} : ressource distante`);
    assert.match(html, /<html[^>]*\blang="/, `${file} : attribut lang`);
    assert.match(html, /<title>[^<]+<\/title>/, `${file} : titre`);
  }
  for (const f of ['renderer/styles.css', 'renderer/help.css']) {
    assert.doesNotMatch(read(f), /url\(\s*['"]?(?:https?:|\/\/|data:)/i, `${f} : ressource distante`);
    assert.doesNotMatch(read(f), /@import/i, `${f} : @import`);
  }
  // Les pages d'aide n'ont pas de script.
  for (const file of HTML.slice(1)) assert.doesNotMatch(read(file), /<script/i, file);
});

test('HTML : toutes les ressources locales référencées existent', () => {
  for (const file of HTML) {
    const html = read(file);
    for (const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
      assert.ok(exists('renderer', m[1]), `${file} -> ${m[1]} introuvable`);
    }
  }
  for (const f of ['renderer/styles.css', 'renderer/help.css']) {
    for (const m of read(f).matchAll(/url\(\s*['"]?([^'")]+)/g)) assert.ok(exists('renderer', m[1]), `${f} -> ${m[1]} introuvable`);
  }
});

test('index.html : chaque id utilisé par renderer.js existe', () => {
  const html = read('renderer/index.html');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const js = read('renderer/renderer.js');
  const wanted = new Set([...js.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]));
  for (const m of js.matchAll(/getElementById\('([\w-]+)'\)/g)) wanted.add(m[1]);
  assert.ok(wanted.size > 10);
  for (const id of wanted) assert.ok(ids.has(id), `#${id} absent de index.html`);
  assert.equal(ids.size, [...html.matchAll(/\bid="([^"]+)"/g)].length, 'ids dupliqués');
});

test('index.html : accessibilité de base (libellés, zone de dépôt, listes)', () => {
  const html = read('renderer/index.html');
  assert.match(html, /id="dropzone"[^>]*tabindex="0"[^>]*role="button"/);
  assert.match(html, /id="dropzone"[^>]*aria-label=/);
  assert.match(html, /id="queue"[^>]*aria-live=/);
  for (const id of ['format', 'samplerate', 'adv-quality', 'adv-fps', 'adv-size', 'adv-audio', 'adv-start']) {
    assert.match(html, new RegExp(`<label[^>]*for="${id}"`), `label pour #${id}`);
  }
  for (const id of ['adv-start', 'adv-end']) assert.match(html, new RegExp(`id="${id}"[^>]*placeholder=`), id);
});

test('pages d\'aide : même structure en français et en anglais', () => {
  const count = (html, re) => (html.match(re) || []).length;
  const fr = read('renderer/help.fr.html');
  const en = read('renderer/help.en.html');
  assert.match(fr, /<html lang="fr"/);
  assert.match(en, /<html lang="en"/);
  for (const re of [/<h1>/g, /<h2>/g, /<li>/g, /<kbd>/g, /<ul>/g, /<ol>/g, /<p>/g]) assert.equal(count(fr, re), count(en, re), String(re));
  assert.ok(count(fr, /<h2>/g) >= 8);
  assert.match(fr, /<h1>Aide Kinoshift<\/h1>/);
  assert.match(en, /<h1>Kinoshift Help<\/h1>/);
  // Chaque langue gérée a sa page.
  for (const lang of Object.keys(LOCALES)) assert.ok(exists('renderer', `help.${lang}.html`), lang);
  // Les libellés de menu cités dans l'aide existent bien dans l'interface.
  assert.match(fr, new RegExp(LOCALES.fr['menu.feedback.idea'].replace('…', '…')));
  assert.match(en, new RegExp(LOCALES.en['menu.feedback.idea']));
});

// ---------- Sécurité du code ----------

test('sécurité : fenêtres isolées (sandbox, contextIsolation, pas de nodeIntegration), navigation bloquée', () => {
  const main = read('main.js');
  const windows = main.match(/new BrowserWindow\(/g).length;
  assert.equal(main.match(/contextIsolation: true/g).length, windows);
  assert.equal(main.match(/nodeIntegration: false/g).length, windows);
  assert.equal(main.match(/sandbox: true/g).length, windows);
  assert.equal(main.match(/will-navigate/g).length, windows);
  assert.equal(main.match(/setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/g).length, windows);
  for (const bad of ['webSecurity: false', 'allowRunningInsecureContent', 'enableRemoteModule', 'nodeIntegration: true', 'contextIsolation: false', 'sandbox: false', 'webviewTag']) {
    assert.ok(!main.includes(bad), bad);
  }
});

test('sécurité : jamais de shell ni d\'exécution de commande par chaîne', () => {
  for (const file of SOURCES) {
    const src = read(file);
    assert.doesNotMatch(src, /shell:\s*true/, file);
    assert.doesNotMatch(src, /\{[^}]*\bexec(?:Sync)?\b[^}]*\}\s*=\s*require\('(?:node:)?child_process'\)/, file);
    assert.doesNotMatch(src, /child_process'\)\.(?:exec|execSync)\b/, file);
    assert.doesNotMatch(src, /\beval\(|new Function\(/, file);
    assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|document\.write/, file);
  }
});

test('sécurité : openExternal n\'ouvre que des URL https constantes', () => {
  const menu = read('lib/menu.js');
  const consts = Object.fromEntries([...menu.matchAll(/const (\w+_URL) = '([^']+)'/g)].map((m) => [m[1], m[2]]));
  for (const url of Object.values(consts)) assert.match(url, /^https:\/\/[\w.-]+\.[a-z]{2,}(\/\S*)?$/);
  for (const m of menu.matchAll(/openExternal\(([^)]+)\)/g)) {
    const arg = m[1].trim();
    if (arg.startsWith("'")) assert.match(arg, /^'https:\/\//, arg);
    else assert.ok(arg in consts, `argument non constant : ${arg}`);
  }
  assert.equal(consts.DONATE_URL, 'https://ko-fi.com/kinoshift');
  assert.equal(consts.FEEDBACK_URL, 'https://kinoshift.supahub.com');
  // Aucun autre appel à openExternal ailleurs.
  for (const f of ['main.js', 'preload.js', 'renderer/renderer.js']) assert.doesNotMatch(read(f), /openExternal/, f);
});

test('sécurité : le preload n\'expose que l\'API prévue et jamais ipcRenderer', () => {
  const preload = read('preload.js');
  assert.doesNotMatch(preload, /exposeInMainWorld\('\w+',\s*(?:ipcRenderer|require)/);
  const exposed = [...preload.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]).sort();
  assert.deepEqual(exposed, ['cancel', 'chooseFfmpeg', 'chooseFiles', 'chooseFolder', 'convert', 'getI18n', 'ffmpegStatus', 'listPresets', 'onMenuAction', 'onProgress', 'pathForFile', 'reveal'].sort());
  // Chaque canal IPC invoqué par le preload a un gestionnaire dans le processus principal.
  const main = read('main.js');
  for (const m of preload.matchAll(/invoke\('([\w:]+)'/g)) assert.match(main, new RegExp(`ipcMain\\.handle\\('${m[1]}'`), m[1]);
});

test('sécurité : le processus principal valide les paramètres venant du renderer', () => {
  const main = read('main.js');
  assert.match(main, /path\.isAbsolute\(input\)/);
  assert.match(main, /path\.isAbsolute\(outputDir\)/);
  assert.match(main, /isString\(jobId\)/);
  assert.match(main, /Number\.isInteger\(sampleRate\)/);
});

test('tous les require locaux se résolvent', () => {
  for (const file of [...SOURCES.filter((f) => !f.startsWith('renderer')), 'scripts/fetch-ffmpeg.js', 'scripts/check-ffmpeg.js', 'scripts/set-dev-name.js']) {
    for (const m of read(file).matchAll(/require\('(\.[^']+)'\)/g)) {
      assert.doesNotThrow(() => require.resolve(path.resolve(path.dirname(path.join(ROOT, file)), m[1])), `${file} -> ${m[1]}`);
    }
  }
});

// ---------- Empaquetage ----------

test('package.json : champs essentiels et fichiers embarqués', () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.name, 'kinoshift');
  assert.equal(pkg.build.productName, 'Kinoshift');
  assert.ok(exists(pkg.main));
  assert.equal(pkg.license, 'GPL-3.0-or-later');
  assert.match(read('LICENSE'), /GNU GENERAL PUBLIC LICENSE\s+Version 3/);

  const files = pkg.build.files;
  for (const f of ['main.js', 'preload.js', 'lib/**', 'renderer/**', 'build/icon.png']) assert.ok(files.includes(f), `${f} absent de build.files`);
  for (const f of files) assert.doesNotMatch(f, /^(test|scripts|vendor|node_modules)/, `${f} ne doit pas être embarqué`);
  // Les fichiers lus à l'exécution par main.js sont bien embarqués.
  assert.ok(files.includes('build/icon.png') && exists('build/icon.png'));
  for (const f of ['preload.js']) assert.ok(exists(f));
});

test('package.json : FFmpeg embarqué dans les ressources pour chaque plateforme', () => {
  assert.deepEqual(pkg.build.extraResources, [{ from: 'vendor/ffmpeg/${os}-${arch}', to: 'ffmpeg' }]);
  const mac = pkg.build.mac.target[0];
  assert.deepEqual(mac.arch.sort(), ['arm64', 'x64']);
  assert.equal(pkg.build.win.target[0].target, 'nsis');
  for (const key of ['mac-arm64', 'mac-x64', 'win-x64']) assert.ok(exists('vendor/ffmpeg', key), `vendor/ffmpeg/${key} absent (npm run fetch-ffmpeg)`);
  // Les scripts de distribution récupèrent les binaires avant de construire.
  assert.match(pkg.scripts['dist:mac'], /fetch-ffmpeg\.js mac-arm64 mac-x64/);
  assert.match(pkg.scripts['dist:win'], /fetch-ffmpeg\.js win-x64/);
  assert.match(pkg.scripts.dist, /fetch-ffmpeg\.js all/);
  assert.match(pkg.scripts['dist:mac'], /check-ffmpeg\.js/);
});

test('macOS beta builds explicitly use ad-hoc signing', () => {
  assert.equal(pkg.build.mac.identity, '-');
  assert.equal(pkg.build.mac.hardenedRuntime, false);
});

test('icônes : PNG 1024 px carré, ICNS et ICO valides', () => {
  const png = fs.readFileSync(path.join(ROOT, 'build/icon.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1024, 1024]);
  assert.equal(fs.readFileSync(path.join(ROOT, 'build/icon.icns')).subarray(0, 4).toString(), 'icns');
  const ico = fs.readFileSync(path.join(ROOT, 'build/icon.ico'));
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2)], [0, 1]);
  assert.ok(ico.readUInt16LE(4) >= 1, 'au moins une image dans l\'ICO');
});

// ---------- FFmpeg fourni ----------

const FETCH = read('scripts/fetch-ffmpeg.js');
const targetSha = (key) => new RegExp(`'${key}': \\{[\\s\\S]*?sha: '([0-9a-f]{64})'`).exec(FETCH)?.[1];

test('fetch-ffmpeg : version épinglée, URL https et empreinte SHA-256 pour chaque cible', () => {
  const version = /const FFMPEG_VERSION = '([\d.]+)'/.exec(FETCH)[1];
  assert.match(version, /^\d+\.\d+\.\d+$/);
  for (const key of ['mac-arm64', 'mac-x64', 'win-x64']) assert.match(targetSha(key) ?? '', /^[0-9a-f]{64}$/, key);
  assert.doesNotMatch(FETCH, /http:\/\//);
  assert.match(FETCH, /sha256\(.*\)\s*!==|!==\s*[\w.]*sha/s, 'l\'empreinte est vérifiée');
});

test('FFmpeg fourni : empreinte de l\'archive, licence et README présents pour chaque plateforme', () => {
  for (const key of ['mac-arm64', 'mac-x64', 'win-x64']) {
    const dir = path.join('vendor/ffmpeg', key);
    assert.ok(exists(dir, key.startsWith('win') ? 'ffmpeg.exe' : 'ffmpeg'), `${key} : binaire`);
    assert.equal(read(dir, '.archive-sha256').trim(), targetSha(key), `${key} : empreinte`);
    assert.match(read(dir, 'LICENSE'), /GNU/, `${key} : licence`);
    assert.ok(read(dir, 'README').length > 0, `${key} : README`);
  }
});

test('FFmpeg fourni (plateforme courante) : version, encodeurs requis et build GPL', async (t) => {
  const key = { darwin: 'mac', win32: 'win' }[process.platform] && `${{ darwin: 'mac', win32: 'win' }[process.platform]}-${process.arch}`;
  const bin = key && path.join(ROOT, 'vendor/ffmpeg', key, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (!bin || !fs.existsSync(bin)) return t.skip('pas de FFmpeg fourni pour cette plateforme');

  const version = spawnSync(bin, ['-version'], { encoding: 'utf8' }).stdout;
  const expected = /const FFMPEG_VERSION = '([\d.]+)'/.exec(FETCH)[1];
  assert.match(version, new RegExp(`^ffmpeg version n?${expected.replace(/\./g, '\\.')}`), 'version épinglée');
  assert.match(version, /--enable-gpl/, 'build GPL (x264/x265)');

  const { listEncoders } = require('../lib/ffmpeg-locate');
  const encoders = await listEncoders(bin);
  const missing = requiredEncoders().filter((e) => !encoders.has(e));
  assert.deepEqual(missing, [], 'encodeurs manquants');
});

test('FFmpeg fourni (Windows) : binaire PE x64 valide et chaîne de configuration complète', () => {
  const bin = path.join(ROOT, 'vendor/ffmpeg/win-x64/ffmpeg.exe');
  const buf = fs.readFileSync(bin);
  assert.equal(buf.subarray(0, 2).toString(), 'MZ');
  const pe = buf.readUInt32LE(0x3c);
  assert.equal(buf.subarray(pe, pe + 4).toString('latin1'), 'PE\0\0');
  assert.equal(buf.readUInt16LE(pe + 4), 0x8664, 'machine x86-64');
  for (const lib of ['libx264', 'libx265', 'libvpx', 'libopus', 'libmp3lame', 'libvorbis']) {
    assert.ok(buf.includes(`--enable-${lib}`), `${lib} dans la configuration`);
  }
});

test('FFmpeg fourni (macOS) : exécutable Mach-O de la bonne architecture', () => {
  for (const [key, cpu] of [['mac-arm64', 0x0100000c], ['mac-x64', 0x01000007]]) {
    const buf = fs.readFileSync(path.join(ROOT, 'vendor/ffmpeg', key, 'ffmpeg'));
    assert.equal(buf.readUInt32LE(0), 0xfeedfacf, `${key} : Mach-O 64 bits`);
    assert.equal(buf.readUInt32LE(4), cpu, `${key} : architecture`);
    assert.ok(fs.statSync(path.join(ROOT, 'vendor/ffmpeg', key, 'ffmpeg')).mode & 0o111, `${key} : exécutable`);
  }
});

test('scripts/check-ffmpeg.js réussit sur les binaires fournis', (t) => {
  const res = spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-ffmpeg.js')], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
});
