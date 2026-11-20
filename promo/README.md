# Promo video

`record.ts` makes the home page's promo video from the real editor. The story: six flat raw
clips become a finished reel. The edit covers trimming, a colour look, transitions, music, an
animated title, a text-to-speech voiceover and auto captions. Then comes export, a
before | after of the real exported file, the code, and the end card.

How it works:

- **Recording.** The editor runs in Chrome on a laptop-sized screen (1470 × 956 at 2×) with a
  drawn cursor. The DevTools screencast captures every painted frame with its time.
- **Composing.** A compositor page rebuilds constant 30 fps video at 1920 × 1248. It eases a
  camera in on the part of the screen being worked on (the 2× frames keep the zoom sharp), draws
  the caption pill, and builds the payoff from `promo/work/reel.mp4`, which is the editor's own
  export.
- **Cards and poster.** The title, code and end cards and the poster are `cards.html`, recorded
  the same way.

Outputs land in `promo/work/out/`. Add `--publish` to also copy them to
`apps/playground/public/home/`:

- `promo.mp4`: 1920 × 1248, 30 fps, H.264 + AAC, faststart
- `promo-poster.jpg`: a cover, 1600 px wide
- `promo.vtt`: captions of the voiceover, with its real times

## Remake it

1. `sh promo/fetch.sh` downloads the stock clips and music into `promo/clips/`. Sources and
   licences are in `CREDITS.md`.
2. Run the playground dev server. The AI steps need its text-to-speech and captions services.
3. `node promo/record.ts --base http://localhost:3203 --env <path to a .env with the key>`.
   Node 24 runs the TypeScript directly.

Options:

- `--headed`: show the browser.
- `--crf 23`: the final quality (lower = bigger file).
- `--from-mix`: redo only the audio and the encode from the last recording (`promo/work/plan.json`).
- `--publish`: copy the outputs into the site.

The voice: ElevenLabs reads each line with the voice "Jessica" on the model `eleven_v3`. The key
comes from `ELEVENLABS_API_KEY` or `ELEVEN_LABS_KEY`, either in the environment or in the
`--env` file. Lines are rendered one at a time and cached in `promo/work/voice-cache/` by
voice + model + text, so a rerun spends no quota. Without a key, the macOS `say` voice stands in.
`node promo/voice.ts` renders only the voice.

Two things the script works around in the editor:

- **Several files at once land reversed.** Each new file goes after the clip under the playhead,
  so files 2–6 come in reversed. The script makes the stage's Add media use the editor's
  "start" place, which keeps the given order, and fails if the order is still wrong.
- **The import moment is cut.** Clips, thumbnails and the media list fill in one by one during
  the import, and the list jumps as each "Adding…" row comes and goes. The video cuts from the
  click straight to the finished timeline.

Scene lengths follow the voice: each scene lasts at least as long as its line plus a little air.
Everything else goes in `promo/work/`, which is not committed: working copies of the clips, raw
frames, scene videos, the mix and the exported reel.
