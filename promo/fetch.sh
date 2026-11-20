#!/bin/sh
# Downloads the promo video's stock clips and music into promo/clips (see CREDITS.md).
set -e
cd "$(dirname "$0")"
mkdir -p clips
for id in 40102 51500 41576 43941 49878 2168; do
  [ -f "clips/$id.mp4" ] || curl -fsSL -o "clips/$id.mp4" "https://assets.mixkit.co/videos/$id/$id-1080.mp4"
done
[ -f clips/music-13.mp3 ] || curl -fsSL -o clips/music-13.mp3 "https://assets.mixkit.co/music/13/13.mp3"
echo "promo clips ready in $(pwd)/clips"
