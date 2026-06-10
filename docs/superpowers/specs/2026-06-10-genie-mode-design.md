# Genie Mode — Design Spec

**Date:** 2026-06-10
**Status:** Approved

## Summary

Combine the existing p5.js Space Invaders game with the local Ollama chat client into
**Genie Mode**: a new page where, between waves, a mischievous monkey's-paw genie
(the local LLM) grants exactly one wish per wave by writing JavaScript that runs
against the live game.

## Concept

- The player clears a wave and enters a **wishing phase**.
- They chat with the genie (Ollama, model `minimax-m3:cloud`) in a side panel and
  ask for anything: "make my bullets faster", "give me a shield", "make the aliens
  move in a spiral".
- The genie grants the wish by emitting JavaScript, played as a **monkey's paw**:
  it is encouraged to add a twist or cost ("faster bullets? sure… for the aliens too").
- One granted wish per wave. Wishes accumulate across waves; everything resets on
  game over / restart.
- The classic game at `index.html` is unaffected.

## Files & pages

| File | Role |
|---|---|
| `genie.html` | New page: game canvas left, genie chat panel right. Sets `window.GENIE_MODE = true` **before** loading `sketch.js`. |
| `genie.css` | Layout + chat styling adapted from `chat.css`, matching the retro arcade look of `style.css`. |
| `genie.js` | Genie client adapted from `chat.js`: Ollama streaming, persona prompt, code extraction and execution, wish-phase UI state. |
| `sketch.js` | Refactored in place (see below). Still loaded unchanged by `index.html`; genie behavior is gated on `window.GENIE_MODE`. |
| `chat.html` / `chat.css` / `chat.js` | Unchanged; kept as a minimal reference client. |

## Game refactor (`sketch.js`)

### Mutable config

The tuning `const`s move into one mutable object the genie can write to:

```js
const config = {
  playerSpeed: 5,
  bulletSpeed: 7,
  enemyBulletSpeed: 4,
  enemyRows: 5,
  enemyCols: 8,
  enemyHSpacing: 48,
  enemyVSpacing: 40,
  enemyStartY: 80,
  enemyBaseDrop: 12,
  enemyFireChance: 0.008,
  enemyShootersPerRow: 2,
};
```

`GAME_WIDTH` and `GAME_HEIGHT` stay `const`. All game code reads from `config`
instead of the old constants. `config` is reset to defaults on full restart.

### `"wishing"` game state

New state alongside `start | playing | paused | gameover | victory`:

- In genie mode, `checkWinLose()` transitions to `wishing` when a wave is cleared
  (instead of immediately spawning the next wave).
- The canvas shows a "WAVE CLEARED — make a wish" overlay while in `wishing`.
- The next wave spawns and play resumes when `genie.js` calls a `startNextWave()`
  function (after a wish is granted or skipped).
- Without `GENIE_MODE`, waves chain instantly exactly as today.

### Hook system

A small global `genie` object exposed by `sketch.js`:

```js
const genie = {
  hooks: { onUpdate: [], onDraw: [] },
  activeWishes: [],            // { text, code } for context + HUD/debugging
  applyWish(code) { ... },     // returns { ok: true } or { ok: false, error }
  resetEffects() { ... },      // clears hooks, activeWishes, restores config
};
```

- `hooks.onUpdate` runs each frame after the built-in update steps; `hooks.onDraw`
  runs after the built-in draw steps. Both only run while `gameState === "playing"`.
- Each hook is invoked in a try/catch. A hook that throws is removed from the array
  and the error is surfaced to the chat panel (via a callback `genie.js` registers),
  rather than freezing the game.
- `applyWish(code)` executes the LLM's JavaScript via `new Function(code)` in a
  try/catch. Because `sketch.js` declares its state with top-level `let` in a classic
  script, wish code can read and write `player`, `enemies`, `bullets`, `config`, etc.
  directly, and call helpers like `explode()` and `fireBullet()`.
- `resetEffects()` is called on restart and game over.

## Genie client (`genie.js`)

Adapted from `chat.js` (same Ollama endpoint, model, NDJSON streaming).

### Persona & prompt

System prompt establishes:

- **Character:** a mischievous monkey's-paw genie. Grants what is asked, but is
  encouraged to add a twist or cost. Short, in-character banter.
- **Output contract:** when granting a wish, reply with banter plus **exactly one**
  fenced ` ```js ` code block. When merely chatting/negotiating, no code block.
- **Game API documentation:** the `config` fields, state arrays (`player`,
  `enemies`, `bullets`, `enemyBullets`, `barriers`, `particles`), score/lives/level,
  the hook system (`genie.hooks.onUpdate/onDraw` push functions), and helpers
  (`explode(x, y, r, g, b)`, `spawnEnemies()`).
- **Constraints:** keep snippets small and self-contained; never call
  `startNextWave()` or change `gameState` directly.

### Wish-phase flow

1. During combat the chat input is disabled with placeholder text
   ("the genie sleeps while you fight…").
2. On entering `wishing`, the input enables and the request to the model includes a
   **game-state snapshot**: score, lives, level, current `config`, and the list of
   active wishes — so twists can be informed.
3. The player may chat back and forth freely; the wish is only **spent** when a
   genie reply contains a code block.
4. Grant: extract the code block → `genie.applyWish(code)` →
   - **Success:** show a "✨ wish granted" marker in the log; start the next wave
     after a ~2 second beat.
   - **Error:** send the error message back to the model for **one automatic
     retry**. If the retry also fails, the wish *fizzles* (in-character message)
     and the next wave starts anyway.
5. A **Skip wish** button (visible only during `wishing`) starts the next wave
   without a wish.
6. Conversation history persists across waves so the genie remembers earlier wishes.

## Layout (`genie.html` / `genie.css`)

- Flexbox row: game canvas (fixed 480×640) left, chat panel right (fills remaining
  width, min ~320px). Stacks vertically on narrow screens.
- Chat panel reuses the structure of `chat.html` (status line, scrolling log,
  input + send button) plus the Skip wish button, restyled to the arcade palette
  (black background, green/yellow accents, `Courier New`).

## Error handling

- **Ollama unreachable / model missing:** status banner in the chat panel (same
  check as `chat.js`); the wishing phase then only offers Skip. The game remains
  fully playable without the genie.
- **Wish code throws at apply time:** one automatic retry with the error fed back;
  then fizzle.
- **Hook throws at runtime:** offending hook removed, error reported to the chat
  log, game continues.
- **No code block in a granting context:** treated as chat, not an error — the
  player just keeps talking or skips.

## Testing (manual checklist)

No test infrastructure exists in this repo; verification is a manual playthrough:

1. `index.html` plays identically to before the refactor (movement, shooting,
   pause, wave chaining, game over, restart).
2. Genie page: a number-tweak wish (e.g. "faster bullets") visibly changes play.
3. A behavior wish (e.g. "aliens move in a wave pattern") works via hooks.
4. A deliberately broken wish triggers retry, then fizzles gracefully.
5. Restart after game over clears all effects and restores default `config`.
6. With Ollama stopped, the genie page degrades to a playable game with Skip-only
   intermissions.

## Out of scope

- Persisting wishes or high scores across page reloads.
- Sandboxing the LLM's code (local game, local model — a broken run is the blast
  radius, and restart fully recovers).
- Touch/mobile support for the chat panel beyond basic responsive stacking.
- Changes to the deployed classic game beyond the invisible refactor.
