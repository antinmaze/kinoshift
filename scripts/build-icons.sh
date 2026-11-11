#!/bin/sh
# Régénère build/icon.png, build/icon.icns et build/icon.ico à partir de build/icon.svg.
# Nécessite macOS (qlmanage, iconutil) et ImageMagick (`brew install imagemagick`).
set -e
cd "$(dirname "$0")/../build"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 1. Rendu du SVG sans l'ombre portée, puis découpe en carré arrondi transparent.
sed 's/ filter="url(#shadow)"//' icon.svg > "$TMP/body.svg"
qlmanage -t -s 1024 -o "$TMP" "$TMP/body.svg" >/dev/null 2>&1
magick -size 1024x1024 xc:black -fill white -draw "roundrectangle 100,100 923,923 185,185" "$TMP/mask.png"
magick "$TMP/body.svg.png" "$TMP/mask.png" -alpha off -compose CopyOpacity -composite "$TMP/body_t.png"

# 2. Ombre portée Apple, centrée dans le canevas 1024x1024.
magick "$TMP/body_t.png" \( +clone -fill '#4d0a33' -colorize 100 -channel A -blur 0x18 \
  -evaluate multiply 0.3 +channel -roll +0+14 \) +swap -compose over -composite icon.png

# 3. Icônes macOS (.icns) et Windows (.ico).
mkdir "$TMP/icon.iconset"
for s in 16 32 128 256 512; do
  magick icon.png -resize "${s}x${s}" "$TMP/icon.iconset/icon_${s}x${s}.png"
  magick icon.png -resize "$((s * 2))x$((s * 2))" "$TMP/icon.iconset/icon_${s}x${s}@2x.png"
done
iconutil -c icns "$TMP/icon.iconset" -o icon.icns
magick icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
echo "Icônes générées dans build/"
