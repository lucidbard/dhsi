# Space Invaders (p5.js)

A small browser-based **Space Invaders** clone, built with [p5.js](https://p5js.org/).

## Play

🎮 **Live game:** https://lucidbard.github.io/dhsi/

Then use:

- **Left / Right** arrows or **A / D** to move the ship
- **Space** to shoot
- **P** to pause / resume
- **R** to restart

Touch screens: tap the left/right side of the canvas to move, tap the middle to fire.

## Run locally

The whole game is three static files — just open `index.html` in a browser, or serve the folder with anything that serves static files (e.g. `python -m http.server`).

## Genie Mode 🧞

`genie.html` is the same game possessed by a monkey's-paw genie, played by a
local LLM. Clear a wave, make a wish in the chat panel ("faster bullets",
"make the aliens dance"), and the genie grants it by rewriting the live game —
usually with a twist. One wish per wave; everything resets when you restart.

It needs [Ollama](https://ollama.com/) running locally with the
`minimax-m3:cloud` model:

    ollama pull minimax-m3:cloud

Serve the folder (Ollama's CORS can reject pages opened via `file://`):

    python -m http.server 8000

then open <http://localhost:8000/genie.html>. Without Ollama the page still
works as a normal game — intermissions just offer "Skip".

## Files

- `index.html` / `style.css` / `sketch.js` — the classic game
- `genie.html` / `genie.css` / `genie.js` — Genie Mode (game + wish chat panel)
- `chat.html` / `chat.css` / `chat.js` — minimal standalone Ollama chat client
- `tests/` — browser-based test pages; run them headless with Edge:
  `msedge --headless=new --disable-gpu --virtual-time-budget=5000 --dump-dom tests\<page>.html`
  and check for `RESULT|PASS`
- `docs/superpowers/` — design spec and implementation plan
