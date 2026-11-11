# Kinoshift

**Version BETA** : l'application est encore en cours de test et peut présenter des bugs.

Convertisseur audio et vidéo simple (macOS et Windows), basé sur Electron et FFmpeg.
Réécriture de Miro Video Converter 3 (GPL).

## Prérequis

- Node.js 22.12 ou version ultérieure.
- Pour le développement, FFmpeg est détecté automatiquement ou peut être choisi manuellement dans l'application. Un binaire compatible peut aussi être téléchargé avec `npm run fetch-ffmpeg`.

## Développement

```sh
npm install
npm run fetch-ffmpeg       # télécharger FFmpeg pour la plateforme courante
npm start      # lancer l'app
```

Les exécutables FFmpeg ne sont pas inclus dans le dépôt. Le script de téléchargement vérifie l'empreinte SHA-256 des archives. Pour lancer la suite complète, télécharger les binaires des trois plateformes, puis exécuter les tests :

```sh
npm run fetch-ffmpeg -- all
npm run test:all
```

`npm test` lance les tests unitaires et d'intégration ; `npm run test:e2e` lance les tests de l'interface Electron.

## Créer les installeurs

```sh
npm run dist:mac   # .dmg (à lancer sur macOS)
npm run dist:win   # installeur NSIS .exe (idéalement sur Windows)
```

Les scripts de distribution téléchargent les binaires FFmpeg nécessaires. Les installeurs sont générés dans `dist/` avec les icônes fournies.
La signature / notarisation macOS et la signature Windows ne sont pas configurées.
