# Dear Dashami — A Friendship Memory Website 🤝

## Heart → clip → song → site
The opening heart is the trigger. Clicking it plays **`assets/clip.mp4`** full-screen with its own original audio (never muted, never replaced). The clip does not play on page load. When the video's real `ended` event fires, the existing website song starts (through the existing music player, no second audio element) and the existing opening animation runs into the website. The song is held back (`window.__musicHold` in `script.js`) while the clip plays, so the two never overlap, and it is no longer started by the login.
Safety net: if the clip is missing or cannot decode, or never starts within 20 s, the site opens anyway (no blank screen). If a browser refuses sound until one more tap, a "Tap to play" button appears (the video is never muted to get around that). Logic lives in `intro.js` (`IntroVideo.play()`), the heart handler is in `script.js` (`releaseMusic()` / `runOpeningSequence()`), and the overlay markup is the first block in `index.html`.

## Login gate
The gate asks for a name and password (both compared case-insensitively). They are set at the top of the gate section in `script.js`: `WEBSITE_NAME = "shrinivas"`, `WEBSITE_PASSWORD = "dashmi"` (the spelling "dashami" is accepted too).

## How to personalize it (do this first!)
Open **script.js** and edit the `CONFIG` object at the very top. That's the only place you need to touch for content:
- `metSince` — the date this friendship began (powers the "Our Story" live tracker)
- `birthdayMonth` / `birthdayDay` — currently 21 October (10 / 21); the countdown always targets the next 21 October
- `trioImage` — path of the photo shown in the Trio section (default `assets/trio/trio-1.jpg`)
- `gallery` (4 cards only), `timeline`, `wishes`, `reasons` — your own captions/text
- `loveQuotes` — short friendship lines for the Friendship Quotes section
- `thoughts` — the short lines in the Friendship Thoughts section (right after Our Story)
- `autoDetectGalleryPhotos` — leave `false` (default). Set the gallery photo paths in `gallery` instead; `true` re-enables probing for `assets/gallery1.jpg…` which causes harmless 404s in the console
- `littleThings` — short lines for "Little Things About You I Appreciate"
- `quiz` — the 4 "how well do you know us" questions (`correct` is the 0-based index of the right option)
- `letter` — your secret friendship letter text (the envelope one)
- `heartStillSays` — the 4 quote cards for "Things I Want You To Know"
- `foreverQuote` — the closing line on the finale section (`#proposal` → `#celebration`; the section id is just a code name, it is the "Final Chapter")
- `finaleMessage` / `finaleSecret` — the message and hidden reveal text on the "MORE MEMORIES AHEAD 🎉" finale shown right after the YES button is tapped
- `tracks` — fallback paths to your music files (used if the `songs/manifest.json` fetch fails, e.g. opening the file locally)

## Adding real photos
Right now the dedicated photo spots are wired up but empty, so the site works instantly with zero setup while you gather the real files. Drop your own images into `assets/` using the existing filenames (`pic1.jpg`–`pic11.jpg`, `su.8.webp`) and each spot picks them up automatically — no code changes needed. Until a file is added, that spot shows a small "add your own photo here" note instead of a broken image.

For the Gallery grid, use `style="background-image:url('assets/yourphoto.jpg'); background-size:cover;"` in `initGallery()`.

## Adding music
The player is a playlist. List your songs in `songs/manifest.json` (files live in `songs/`, names are case-sensitive on GitHub Pages):
```json
[
  { "file": "Apna.mp3", "title": "Apna" },
  { "file": "Apna2.mp3", "title": "Apna 2" }
]
```
When a song really ends (the audio element's `ended` event) the next one starts from 0:00, and after the last song it wraps back to the first. The 🔁 button repeats just the current song while it is switched on. A song whose file is missing is skipped with a small note in the player (so `Apna2.mp3` must be added to `songs/` for the second song to play). If the browser blocks sound, a "Tap to play our song" button appears.

## Publishing on GitHub Pages
All paths are relative and the libraries (three.js, GSAP, Lenis) are bundled in `vendor/`, so the site works from any repository sub-path. Upload the **contents** of this folder (so `index.html` sits at the repo root), then Settings → Pages → Deploy from a branch → `main` / `(root)`. The site is at `https://<user>.github.io/<repo>/`. The `.nojekyll` file stops GitHub from processing the files.

## Gallery photos
Drop images named `gallery1.jpg`, `gallery2.png`, `gallery3.webp`, etc. into `assets/` and the gallery grid finds and loads them automatically (checks `.jpg`/`.jpeg`/`.png`/`.webp` for each number). The first 4 slots use the captions already set in `CONFIG.gallery`; anything from `gallery5` onward that's found gets its own new card added automatically.

## Friendship Quotes section
A large premium portrait card (rounded-rectangle glass frame, not a circle) plus a grid of short friendship/birthday quotes. Edit `CONFIG.loveQuotes` to change the wording.

## Friendship Timeline section
Shows three real milestone dates (May 22, 2025 — The Day Our Friendship Got Official; July 6, 2025 — Our First Call; January 25, 2026 — Our First Meet), with the last one styled to stand out. The first two cards have a small hidden "✦" you can tap for a private line. Right below the timeline is a dedicated special photo space, which has its own hidden "✦" revealing a two-line cinematic message. Edit dates/text/hidden messages directly in the `#milestones` section of `index.html`.

## Things I Want You To Know
Four glassmorphism quote cards (`#heart-still-says`), content from `CONFIG.heartStillSays`.

## Birthday Countdown
A card at the top of the opening page (`#bd-card`, inside `#landing`) that appears right after the password is accepted — never on the login screen. It counts down live (days/hours/minutes/seconds) to the next 21 October in the visitor's local time, shows "Happy Birthday, Dashami! 🎂✨ Today is all about you!" on 21 October itself, then rolls to next year. The date is `CONFIG.birthdayMonth` / `CONFIG.birthdayDay`; the logic is `getBirthdayState()` in `script.js`, and the timer is stopped when the opening page is dismissed.

## More Memories Ahead (finale)
The final page (inside `#celebration`) — a large hero photo with a hidden "✦" reveal, followed by the closing quote from `CONFIG.foreverQuote`.

## Running it
Just open `index.html` in a browser — no build step, no server needed (though a local server is needed for the music manifest and gallery auto-detection to fetch correctly; opening the raw file still works via the built-in fallbacks). To share it, upload the whole folder to any static host (Netlify, GitHub Pages, Vercel) or zip it and send it directly.

## Files
- `index.html` — structure/content (including the countdown card and the Trio section)
- `style.css` — the premium glassmorphism design system (aurora/royal blue/violet/gold palette) + all animations
- `script.js` — all interactivity: particles, quiz, friendship-story logic, music player
- `intro.js` — intro video controller
- `assets/` — `intro.mp4` plus dedicated photo spots (`pic1.jpg`–`pic11.jpg`, `su.8.webp`), plus optional numbered `gallery1`, `gallery2`... images for the Gallery grid
- `songs/` — your two MP3s plus `manifest.json`

## Trio section (`#trio`)
Part of the main page (after the Gallery, with its own dot in the side nav, and reachable from the floating **✦ Trio** pill at the top-right). The photo is built out of particles the first time the section scrolls into view (reusing `particle-image.js`), then expands into the full picture; **Replay** runs it again. Falls back to a simple fade when WebGL is unavailable or reduced-motion is on.

**Changing the picture:** put the new image in `assets/trio/` and either overwrite `assets/trio/trio-1.jpg` or change `CONFIG.trioImage` at the top of `script.js`. The frame adapts to the photo's shape. The current file is a temporary placeholder.

## Latest corrections
- **Countdown** is now the first section of the main site (`#birthday`), right after the login → heart screen.
- **Friendship Thoughts** has exactly six cards (`CONFIG.thoughts`).
- **Trio** fills about one laptop screen; the frame follows your photo's own proportions (no cropping).
- **Quiz** heading: "How Do U Know Abt Meh?" (still 4 questions). "What I Never Knew How To Say" page removed.
- **Obviously** → one controlled sequence; the finale photo is `assets/su.8.webp` in a reserved, framed space.
- **Photos** live in `assets/` (`pic1.jpg` … `pic11.jpg`, `su.8.webp`, `assets/trio/trio-1.jpg`). `pic7.jpg` (the "entire world" portrait) and `assets/intro.mp4` were not in the ZIP — add them there.
- **Music:** put the second song at `songs/Apna2.mp3` (already listed in `songs/manifest.json`). The player shows a button per song; if a file is missing it says so and keeps playing the other one. 🔁 repeats the current song; switch it off to continue with the next.
- **Zoom:** every content photo (`data-zoom` in `index.html`) opens in one shared viewer with − / + / Reset / ✕, wheel/pinch zoom, drag to pan, Esc to close.
