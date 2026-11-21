# Video → Ringtone

Frontend-only video → MP3 / M4R (iPhone) converter. Vue 3 + TypeScript + Tailwind v4 + ffmpeg.wasm.

    npm install
    npm run dev        # local dev
    npm run build      # typecheck + production build

## Deploy to Netlify
Push to GitHub → Add new site → Import from Git. Settings come from `netlify.toml`.
After the first deploy, open a Deploy Preview and test a real conversion on desktop and phone.
If the converter fails to start, check the browser console for CSP violations (headers are in `netlify.toml`).

## Notes
- Input files are mounted (not copied) into ffmpeg, so memory use stays reasonable. Files over 1 GB are blocked.
- Add your own domain `<link rel="canonical">` and a privacy note in `index.html` before launch.
