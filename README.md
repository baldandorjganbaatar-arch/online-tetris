# Online Tetris server

## Railway settings
- Root Directory: `/server` (if this folder is inside the repository)
- Start Command: `npm start`
- Public Networking: generate a domain
- WebSocket URL: `wss://YOUR-RAILWAY-DOMAIN/ws`
- Health check: `/health`

This is the first-stage central lobby/relay server. It centralizes player membership,
ready/rematch votes, queued entrants, host assignment, chat, and state relay.
The existing browser game engine still needs a client integration pass before
this server can run a complete game; do not replace the live GitHub Pages frontend yet.
