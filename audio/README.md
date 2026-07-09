# Audio tracks — how to add a beat

This folder holds the preview MP3s that play on highprophetproductions.com.
Any file you put here is served live at:

    https://highprophetproductions.com/audio/<filename>

## Adding a track when the artist delivers (2 steps)

### Step 1 — Upload the MP3
Put the file in this `audio/` folder. Keep names simple and lowercase, no
spaces — use hyphens. Example: `throne-room.mp3`.

Easiest way with no terminal: on GitHub, open this folder →
**Add file → Upload files** → drag the MP3 in → **Commit changes**.

### Step 2 — Point a track at it
Open `index.html`, find the `const tracks=[` list (near the bottom), and set
that track's `src` to the file path. Also fix the title / BPM / key / tags to
the real values the artist gives you. Example:

    { title:'Throne Room', bpm:84, key:'Cm', tags:'Cinematic · Soul', len:201, src:'audio/throne-room.mp3' },

- `src:''` (empty)  → silent animated demo bar (placeholder)
- `src:'audio/throne-room.mp3'` → real playback for every visitor
- `len` is the length in seconds (used before the file loads); optional.

Commit. Cloudflare redeploys automatically and the track is live in ~1 minute.

## Notes
- Use short PREVIEW versions (e.g. 60–90s or a tagged loop) for the public
  player. Deliver the full/untagged file to buyers through checkout, not here.
- MP3 at ~128–192 kbps keeps files small and the site fast.
- Keep each file under 25 MB (Cloudflare Worker per-file limit). Previews are
  far smaller than this.
- For a very large catalog later, switch hosting to Cloudflare R2 and put the
  R2 URL in `src` instead — the player doesn't care where the URL points.
