# Online Tetris — Survival (2–6 players)

Static GitHub Pages build of the browser game.

## Deploy with GitHub Pages

1. Create a **public** GitHub repository (for example `online-tetris`).
2. Upload `index.html`, `database.rules.json`, and this `README.md` to the repository root.
3. In GitHub: **Settings → Pages → Deploy from a branch → main → /(root) → Save**.
4. In Firebase Authentication → Settings → Authorized domains, add your Pages hostname, e.g. `YOUR_GITHUB_USERNAME.github.io`.
5. In Firebase Realtime Database → Rules, publish the rules from `database.rules.json`.

## Firebase project

The Firebase web app config is already embedded in `index.html`. Firebase Anonymous Authentication must be enabled.

## Important prototype limitations

- The host browser acts as the game authority and must stay open during a match.
- This is a prototype. Room writes are authenticated but not restricted to a room owner; do not treat it as production-secure or store private data.
- PeerJS public signaling is used for browser-to-browser connections; reliable connectivity depends on network/NAT conditions.
- Reconnection works only while the host room remains alive and the player token remains in that browser's local storage.
