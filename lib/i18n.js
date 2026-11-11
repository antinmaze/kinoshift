'use strict';

const LOCALES = {
  en: require('./locales/en'),
  fr: require('./locales/fr'),
};
const DEFAULT_LOCALE = 'en';

/** Première langue de la liste (ordre de préférence de l'OS) que l'application sait traduire. */
function resolveLocale(preferred) {
  for (const tag of preferred || []) {
    const lang = String(tag).toLowerCase().split(/[-_]/)[0];
    if (LOCALES[lang]) return lang;
  }
  return DEFAULT_LOCALE;
}

/**
 * Traducteur pour une langue. Une clé absente retombe sur l'anglais, puis sur la clé elle-même.
 * Un paramètre de la forme { key, params } est lui-même traduit (ex. le libellé « Début »).
 */
function createTranslator(locale) {
  const messages = { ...LOCALES[DEFAULT_LOCALE], ...LOCALES[locale] };
  const t = (key, params) =>
    (messages[key] ?? key).replace(/\{(\w+)\}/g, (match, name) => {
      if (!params || !(name in params)) return match;
      const v = params[name];
      return v && typeof v === 'object' && 'key' in v ? t(v.key, v.params) : String(v);
    });
  return { locale: LOCALES[locale] ? locale : DEFAULT_LOCALE, messages, t };
}

/** Erreur dont le texte est traduit au dernier moment, par le processus principal. */
class MessageError extends Error {
  constructor(key, params) {
    super(key);
    this.key = key;
    this.params = params;
  }
}

module.exports = { LOCALES, DEFAULT_LOCALE, resolveLocale, createTranslator, MessageError };
