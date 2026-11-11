'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { getPreset } = require('./presets');
const { applyAdvanced } = require('./advanced');
const { MessageError } = require('./i18n');

/** Chemin de sortie qui n'écrase jamais un fichier existant. */
function uniqueOutputPath(input, outputDir, extension, exists = fs.existsSync) {
  const dir = outputDir || path.dirname(input);
  const base = path.basename(input, path.extname(input));
  let candidate = path.join(dir, `${base}.${extension}`);
  for (let n = 1; exists(candidate) || path.resolve(candidate) === path.resolve(input); n++) {
    candidate = path.join(dir, `${base} (${n}).${extension}`);
  }
  return candidate;
}

function buildArgs(input, output, presetId, sampleRate = null, advanced = null, encoders = null) {
  let preset = getPreset(presetId);
  if (encoders && preset.requires && preset.fallbackArgs && !encoders.has(preset.requires)) {
    preset = { ...preset, args: preset.fallbackArgs };
  }
  const rate = [];
  if (sampleRate != null) {
    if (!preset.sampleRates || !preset.sampleRates.includes(sampleRate)) {
      throw new MessageError('err.sampleRate', { rate: sampleRate });
    }
    rate.push('-ar', String(sampleRate));
  }
  const { inputArgs, outputArgs } = applyAdvanced(preset, advanced);
  return [
    '-hide_banner', '-nostdin', '-y',
    ...inputArgs,
    '-i', input,
    ...outputArgs,
    ...rate,
    '-progress', 'pipe:1', '-nostats',
    output,
  ];
}

function parseDuration(text) {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/** `out_time_us=123456` ou `out_time_ms=123456` (microsecondes dans les deux cas). */
function parseProgressTime(line) {
  const m = /^out_time_(?:us|ms)=(-?\d+)/.exec(line);
  return m ? Number(m[1]) / 1e6 : null;
}

/**
 * Lance une conversion. Retourne { output, promise, cancel }.
 * `promise` se résout avec { output } ou est rejetée (error.canceled === true si annulée).
 */
function convert({
  ffmpegPath, input, outputDir, presetId, sampleRate = null, advanced = null, encoders = null, onProgress = () => {},
}) {
  const preset = getPreset(presetId);
  const output = uniqueOutputPath(input, outputDir, preset.extension);
  const args = buildArgs(input, output, presetId, sampleRate, advanced, encoders);
  const { advanced: adv } = applyAdvanced(preset, advanced);
  // Durée à convertir (tient compte de la découpe) pour calculer la progression.
  const effectiveDuration = (total) => (adv.end !== null ? adv.end - adv.start : total && total - adv.start);

  let canceled = false;
  const child = spawn(ffmpegPath, args, { windowsHide: true });

  const promise = new Promise((resolve, reject) => {
    let duration = null;
    let stderrTail = '';
    let stdoutBuf = '';

    const cleanup = () => fs.promises.rm(output, { force: true }).catch(() => {});

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk).slice(-4000);
      if (duration === null) duration = parseDuration(stderrTail);
    });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk;
      const lines = stdoutBuf.split(/\r?\n/);
      stdoutBuf = lines.pop();
      for (const line of lines) {
        const t = parseProgressTime(line);
        const total = effectiveDuration(duration);
        if (t !== null && total > 0) {
          onProgress(Math.max(0, Math.min(1, t / total)));
        }
      }
    });

    child.on('error', async (err) => {
      await cleanup();
      reject(err);
    });

    child.on('close', async (code) => {
      if (canceled) {
        await cleanup();
        const err = new MessageError('err.canceled');
        err.canceled = true;
        reject(err);
      } else if (code === 0 && duration !== null && adv.start >= duration) {
        // Début de découpe après la fin du média : FFmpeg réussit mais produit un fichier vide.
        await cleanup();
        reject(new MessageError('err.startAfterEnd'));
      } else if (code === 0) {
        onProgress(1);
        resolve({ output });
      } else {
        await cleanup();
        const detail = stderrTail.trim().split(/\r?\n/).slice(-3).join('\n');
        reject(detail ? new Error(detail) : new MessageError('err.ffmpegFailed', { code }));
      }
    });
  });

  return {
    output,
    promise,
    cancel() {
      canceled = true;
      child.kill('SIGKILL');
    },
  };
}

module.exports = { convert, buildArgs, uniqueOutputPath, parseDuration, parseProgressTime };
