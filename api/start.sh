#!/bin/sh
# Container entry point: fetch the terrain files that are not in the image, then serve.
# LUNARIS_TERRAIN_URLS is a space-separated list of file URLs (at least the height grid
# LDEM_60S_60MPP_ADJ.TIF; the slope and roughness maps are optional).
set -e
mkdir -p "$LUNAR_TERRAIN_DIR"
for url in $LUNARIS_TERRAIN_URLS; do
  file="$LUNAR_TERRAIN_DIR/$(basename "${url%%\?*}")"
  if [ ! -f "$file" ]; then
    echo "fetching $(basename "$file")"
    curl -fL --retry 5 -o "$file.part" "$url" && mv "$file.part" "$file"
  fi
done
exec uvicorn api.main:app --host 0.0.0.0 --port "${PORT:-7860}"
