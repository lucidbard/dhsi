# Genie Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Genie Mode" page where, between Space Invaders waves, a monkey's-paw genie (local Ollama LLM) grants one wish per wave by writing JavaScript that runs against the live game.

**Architecture:** `sketch.js` is refactored in place (mutable `config`, a `genie` bridge object with hooks, a new `wishing` game state) and stays compatible with the classic `index.html`. A new `genie.html`/`genie.css`/`genie.js` page hosts the game next to a chat panel that streams from Ollama, extracts a ` ```js ` code block from genie replies, and executes it via `genie.applyWish()`.

**Tech Stack:** p5.js 1.9.4 (CDN, global mode), vanilla JS/CSS, Ollama HTTP API (`minimax-m3:cloud`), headless Edge for browser-based tests.

**Spec:** `docs/superpowers/specs/2026-06-10-genie-mode-design.md` — read it first.

---

## Testing approach (read before Task 1)

There is no JS test framework in this repo, and `sketch.js` only runs inside a browser with p5 loaded. Tests are **static HTML pages** that load the real code, run assertions, and print a single `RESULT|PASS|...` or `RESULT|FAIL|...` line into the DOM. They are run with headless Edge:

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --virtual-time-budget=5000 --dump-dom "C:\Users\jo284142\dhsi\tests\<PAGE>.html" | Select-String "RESULT"
```

(`--virtual-time-budget` fast-forwards timers so the page's `setTimeout`-deferred test run completes before the DOM is dumped. This technique was already proven in this repo during spec review.)

**A test page passes when the output line starts with `RESULT|PASS`.** Any `FAIL` or missing RESULT line is a failure. Each failed check is listed in the line, e.g. `RESULT|FAIL|PASS config exists|FAIL config.playerSpeed default|...`.

**Gotcha:** these pages need network access for the p5 CDN. If the RESULT line is missing entirely, the CDN fetch or a top-level script error is the likely cause — load the page in a headed browser and check the console.

---

### Task 1: Test harness + config refactor

Replace the tuning `const`s in `sketch.js` with a mutable `config` object, deleting the old constants so any missed reference fails loudly.

**Files:**
- Create: `tests/harness.js`
- Create: `tests/sketch-genie.test.html`
- Create: `tests/sketch-classic.test.html`
- Modify: `sketch.js` (constants block at lines 8–21, plus every constant reference)

- [ ] **Step 1: Write the test harness**

Create `tests/harness.js`:

```js
// Tiny assertion harness for headless-browser test pages.
// Pages call check(name, fn) for each assertion, then report().
// The runner greps the dumped DOM for "RESULT|PASS" / "RESULT|FAIL".
const results = [];

function check(name, fn) {
  try {
    results.push((fn() ? "PASS " : "FAIL ") + name);
  } catch (e) {
    results.push("FAIL " + name + " (" + e.message + ")");
  }
}

function report() {
  const failed = results.some((r) => !r.startsWith("PASS"));
  document.body.insertAdjacentText(
    "beforeend",
    "RESULT|" + (failed ? "FAIL" : "PASS") + "|" + results.join("|")
  );
}
```

- [ ] **Step 2: Write the failing config tests**

Create `tests/sketch-genie.test.html`. (Later tasks append more checks to this page's `run()`; the `// --- Task N ---` comments mark where.)

```html
<!DOCTYPE html>
<html>
<body>
  <div id="game-container"></div>
  <script>window.GENIE_MODE = true;</script>
  <script src="https://cdn.jsdelivr.net/npm/p5@1.9.4/lib/p5.min.js"></script>
  <script src="../sketch.js"></script>
  <script src="harness.js"></script>
  <script>
    // Wait for p5 to run setup(), then stop its draw loop so manual
    // draw() calls in later checks are deterministic.
    window.addEventListener("load", () => setTimeout(run, 500));

    function run() {
      noLoop();

      // --- Task 1: mutable config replaces tuning consts ---
      check("config exists", () => typeof config === "object" && config !== null);
      check("config.playerSpeed default", () => config.playerSpeed === 5);
      check("config.bulletSpeed default", () => config.bulletSpeed === 7);
      check("config.enemyBulletSpeed default", () => config.enemyBulletSpeed === 4);
      check("config.enemyRows default", () => config.enemyRows === 5);
      check("config.enemyCols default", () => config.enemyCols === 8);
      check("config.enemyHSpacing default", () => config.enemyHSpacing === 48);
      check("config.enemyVSpacing default", () => config.enemyVSpacing === 40);
      check("config.enemyStartY default", () => config.enemyStartY === 80);
      check("config.enemyBaseDrop default", () => config.enemyBaseDrop === 12);
      check("config.enemyFireChance default", () => config.enemyFireChance === 0.008);
      check("config.enemyShootersPerRow default", () => config.enemyShootersPerRow === 2);
      check("old consts deleted", () =>
        typeof PLAYER_SPEED === "undefined" && typeof ENEMY_FIRE_CHANCE === "undefined");
      check("game still sets up (5x8 enemies spawned)", () => enemies.length === 40);
      check("config drives spawning", () => {
        config.enemyRows = 2;
        spawnEnemies();
        const ok = enemies.length === 16;
        config.enemyRows = 5;
        spawnEnemies();
        return ok;
      });

      report();
    }
  </script>
</body>
</html>
```

Also create `tests/sketch-classic.test.html` — same shape but **without** `GENIE_MODE`, guarding the classic game. (Task 3 appends wave-chaining checks to it.)

```html
<!DOCTYPE html>
<html>
<body>
  <div id="game-container"></div>
  <script src="https://cdn.jsdelivr.net/npm/p5@1.9.4/lib/p5.min.js"></script>
  <script src="../sketch.js"></script>
  <script src="harness.js"></script>
  <script>
    window.addEventListener("load", () => setTimeout(run, 500));

    function run() {
      noLoop();

      // --- Task 1: refactor must not break the classic game ---
      check("GENIE_MODE is off", () => !window.GENIE_MODE);
      check("game sets up (5x8 enemies spawned)", () => enemies.length === 40);
      check("barriers spawned", () => barriers.length > 0);
      check("player exists", () => typeof player === "object" && player.x === 240);

      report();
    }
  </script>
</body>
</html>
```

- [ ] **Step 3: Run both pages — verify they FAIL**

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --virtual-time-budget=5000 --dump-dom "C:\Users\jo284142\dhsi\tests\sketch-genie.test.html" | Select-String "RESULT"
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --virtual-time-budget=5000 --dump-dom "C:\Users\jo284142\dhsi\tests\sketch-classic.test.html" | Select-String "RESULT"
```

Expected: genie page prints `RESULT|FAIL|...` with `FAIL config exists` and `FAIL old consts deleted`. Classic page prints `RESULT|PASS|...` already (it only checks current behavior) — that's fine; it's the regression guard.

- [ ] **Step 4: Refactor sketch.js constants into config**

In `sketch.js`, replace the whole constants block (lines 8–21, from `// ---------- Game constants ----------` through `const ENEMY_SHOOTERS_PER_ROW = 2;`) with:

```js
// ---------- Game constants ----------
const GAME_WIDTH = 480;
const GAME_HEIGHT = 640;

// Tunable gameplay values. Genie Mode wishes may rewrite these at runtime;
// genie.resetEffects() restores them from DEFAULT_CONFIG.
const DEFAULT_CONFIG = Object.freeze({
  playerSpeed: 5,
  bulletSpeed: 7,
  enemyBulletSpeed: 4,
  enemyRows: 5,
  enemyCols: 8,
  enemyHSpacing: 48,
  enemyVSpacing: 40,
  enemyStartY: 80,
  enemyBaseDrop: 12,
  enemyFireChance: 0.008, // per enemy per frame
  enemyShootersPerRow: 2,
});
const config = { ...DEFAULT_CONFIG };
```

Then update every reference. The complete set (verify with a search for `ENEMY_` and `PLAYER_SPEED` and `BULLET_SPEED` afterwards — zero hits expected):

In `spawnEnemies()` (currently lines 82–103) — note the added `% 5` so wish-added extra rows don't get `undefined` points:

```js
function spawnEnemies() {
  enemies = [];
  const startX = (width - (config.enemyCols - 1) * config.enemyHSpacing) / 2;
  for (let r = 0; r < config.enemyRows; r++) {
    // Top rows are worth more (squid/crab/crab/crab/crab in the original).
    const points = [40, 30, 20, 20, 10][r % 5];
    for (let c = 0; c < config.enemyCols; c++) {
      enemies.push({
        x: startX + c * config.enemyHSpacing,
        y: config.enemyStartY + r * config.enemyVSpacing + (level - 1) * 12,
        w: 28,
        h: 22,
        row: r,
        col: c,
        alive: true,
        points,
        frame: 0,
      });
    }
  }
  enemySpeed = 1 + (level - 1) * 0.4;
}
```

In `fireBullet()` (line 168): `vy: -BULLET_SPEED,` → `vy: -config.bulletSpeed,`

In `enemyFire()` (lines 177–199): `ENEMY_SHOOTERS_PER_ROW` → `config.enemyShootersPerRow` (line 184), `ENEMY_FIRE_CHANCE` → `config.enemyFireChance` (line 189), `ENEMY_BULLET_SPEED` → `config.enemyBulletSpeed` (line 195).

In `updatePlayer()` (lines 305–313): both `PLAYER_SPEED` → `config.playerSpeed`.

In `updateEnemies()` (line 340): `ENEMY_BASE_DROP` → `config.enemyBaseDrop`.

- [ ] **Step 5: Run both test pages — verify PASS**

Same two commands as Step 3. Expected: both print `RESULT|PASS|...`.

- [ ] **Step 6: Commit**

```powershell
git add tests/harness.js tests/sketch-genie.test.html tests/sketch-classic.test.html sketch.js
git commit -m "refactor: move gameplay constants into mutable config object"
```

---

### Task 2: The `genie` bridge object

Add the `genie` object (hooks, `applyWish`, `resetEffects`, `activeWishes`) and the `runHooks` helper to `sketch.js`, and clear effects on every `resetGame()`.

**Files:**
- Modify: `sketch.js` (insert after the `config` block; one-line change in `resetGame()`)
- Modify: `tests/sketch-genie.test.html`

- [ ] **Step 1: Add failing tests**

In `tests/sketch-genie.test.html`, append inside `run()`, after the Task 1 checks and **before** `report()`:

```js
      // --- Task 2: genie bridge object ---
      check("genie object exists", () => typeof genie === "object" && genie !== null);
      check("hooks arrays exist", () =>
        Array.isArray(genie.hooks.onUpdate) && Array.isArray(genie.hooks.onDraw));
      check("applyWish returns ok and writes config", () => {
        const r = genie.applyWish("config.playerSpeed = 12;");
        return r.ok === true && config.playerSpeed === 12;
      });
      check("applyWish reads live game state", () => {
        const r = genie.applyWish("window.__got = player.x;");
        return r.ok === true && window.__got === player.x;
      });
      check("applyWish captures errors", () => {
        const r = genie.applyWish("this is not javascript");
        return r.ok === false && typeof r.error === "string" && r.error.length > 0;
      });
      check("resetEffects restores config and clears hooks/wishes", () => {
        genie.hooks.onUpdate.push(() => {});
        genie.activeWishes.push({ text: "t", code: "" });
        genie.resetEffects();
        return config.playerSpeed === 5 &&
          genie.hooks.onUpdate.length === 0 &&
          genie.activeWishes.length === 0;
      });
      check("resetGame clears effects", () => {
        config.bulletSpeed = 99;
        genie.hooks.onDraw.push(() => {});
        resetGame();
        return config.bulletSpeed === 7 && genie.hooks.onDraw.length === 0;
      });
```

- [ ] **Step 2: Run — verify the new checks FAIL**

Run the genie test page command (see "Testing approach"). Expected: `RESULT|FAIL|...` where every Task 1 check is PASS and every Task 2 check is FAIL (`genie is not defined`).

- [ ] **Step 3: Implement the genie object**

In `sketch.js`, insert directly after the `const config = { ...DEFAULT_CONFIG };` line:

```js
// ---------- Genie Mode bridge ----------
// genie.js (the chat panel on genie.html) talks to the game exclusively
// through this object. Inert in classic mode: nothing ever calls it.
const genie = {
  hooks: { onUpdate: [], onDraw: [] },
  activeWishes: [], // { text, code } per granted wish, sent back in prompts
  onPhaseChange: null, // set by genie.js; called with "wishing" | "combat"
  onHookError: null, // set by genie.js; called with an error message
  applyWish(code) {
    try {
      new Function(code)();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
  resetEffects() {
    this.hooks.onUpdate.length = 0;
    this.hooks.onDraw.length = 0;
    this.activeWishes.length = 0;
    Object.assign(config, DEFAULT_CONFIG);
  },
};

// Run wish hooks, dropping any that throw so one bad spell can't freeze the game.
function runHooks(list) {
  for (let i = list.length - 1; i >= 0; i--) {
    try {
      list[i]();
    } catch (err) {
      list.splice(i, 1);
      if (genie.onHookError) genie.onHookError(err.message);
    }
  }
}
```

Note: `resetEffects` empties the arrays in place (`length = 0`) and does **not** touch `onPhaseChange`/`onHookError` — those are genie.js wiring that must survive restarts.

In `resetGame()` (currently line 61), add the call as the first line of the function body:

```js
function resetGame() {
  genie.resetEffects();
  player = {
```

- [ ] **Step 4: Run both test pages — verify PASS**

Genie page: all Task 1 + Task 2 checks PASS. Classic page: still `RESULT|PASS` (the genie object is inert without genie.js).

- [ ] **Step 5: Commit**

```powershell
git add sketch.js tests/sketch-genie.test.html
git commit -m "feat: add genie bridge object with wish hooks and effect reset"
```

---

### Task 3: The `wishing` state, `startNextWave()`, and hook wiring

Wire hooks into `draw()`, add the `wishing` game state with its overlay, replace the instant wave chaining in `checkWinLose()`, and stop p5 from swallowing the spacebar while typing in the chat input.

**Files:**
- Modify: `sketch.js` (`draw()`, `checkWinLose()`, `keyPressed()`; add `drawWishing()` and `startNextWave()`)
- Modify: `tests/sketch-genie.test.html`
- Modify: `tests/sketch-classic.test.html`

- [ ] **Step 1: Add failing tests to the genie page**

Append inside `run()` of `tests/sketch-genie.test.html`, before `report()`:

```js
      // --- Task 3: wishing state & startNextWave ---
      check("clearing a wave enters wishing and fires phase change", () => {
        let phase = null;
        genie.onPhaseChange = (p) => { phase = p; };
        gameState = "playing";
        level = 1;
        for (const e of enemies) e.alive = false;
        checkWinLose();
        return gameState === "wishing" && phase === "wishing";
      });
      check("startNextWave begins next level and fires combat phase", () => {
        let phase = null;
        genie.onPhaseChange = (p) => { phase = p; };
        bullets.push({ x: 0, y: 0, w: 1, h: 1, vy: 0, fromPlayer: true });
        startNextWave();
        return level === 2 && gameState === "playing" && phase === "combat" &&
          enemies.some((e) => e.alive) && bullets.length === 0;
      });
      check("clearing level 5 is victory, no wish phase", () => {
        level = 5;
        for (const e of enemies) e.alive = false;
        checkWinLose();
        return gameState === "victory";
      });
      check("onUpdate hook runs once per playing frame", () => {
        resetGame();
        gameState = "playing";
        let ran = 0;
        genie.hooks.onUpdate.push(() => ran++);
        draw();
        genie.hooks.onUpdate.length = 0;
        return ran === 1;
      });
      check("throwing hook is removed and reported", () => {
        let reported = null;
        genie.onHookError = (m) => { reported = m; };
        genie.hooks.onDraw.push(() => { throw new Error("boom"); });
        gameState = "playing";
        draw();
        return genie.hooks.onDraw.length === 0 && reported === "boom";
      });
      check("wishing frame draws overlay without error", () => {
        gameState = "wishing";
        draw();
        return true;
      });
```

- [ ] **Step 2: Add failing tests to the classic page**

Append inside `run()` of `tests/sketch-classic.test.html`, before `report()`:

```js
      // --- Task 3: classic mode chains waves instantly ---
      check("wave clear chains instantly in classic mode", () => {
        gameState = "playing";
        level = 1;
        for (const e of enemies) e.alive = false;
        checkWinLose();
        return gameState === "playing" && level === 2 && enemies.some((e) => e.alive);
      });
      check("victory still triggers after level 5", () => {
        level = 5;
        for (const e of enemies) e.alive = false;
        checkWinLose();
        return gameState === "victory";
      });
```

- [ ] **Step 3: Run both pages — verify the new checks FAIL**

Genie page: Task 3 checks FAIL (`clearing a wave enters wishing` fails because the old `checkWinLose` chains instantly; `startNextWave is not defined` fails the rest). Classic page: the new checks already PASS — the old code chains waves instantly. That's expected: they're regression pins that must STILL pass after the refactor.

- [ ] **Step 4: Implement**

In `sketch.js`, replace the whole `draw()` function (currently lines 202–240) with:

```js
function draw() {
  drawStarField();

  if (gameState === "start") {
    drawStartScreen();
    return;
  }
  if (gameState === "paused") {
    drawHUD();
    drawPaused();
    return;
  }
  if (gameState === "wishing") {
    drawHUD();
    drawWishing();
    return;
  }
  if (gameState === "gameover") {
    drawHUD();
    drawGameOver();
    return;
  }
  if (gameState === "victory") {
    drawHUD();
    drawVictory();
    return;
  }

  // Playing
  updatePlayer();
  updateBullets();
  updateEnemies();
  enemyFire();
  updateParticles();
  runHooks(genie.hooks.onUpdate);
  checkCollisions();
  checkWinLose();

  drawPlayer();
  drawBullets();
  drawEnemies();
  drawBarriers();
  drawParticles();
  drawHUD();
  runHooks(genie.hooks.onDraw);
}
```

Add `drawWishing()` right after `drawVictory()` (currently ends line 303):

```js
function drawWishing() {
  fill(0, 0, 0, 180);
  rectMode(CORNER);
  rect(0, 0, width, height);
  fill(255, 204, 0);
  textAlign(CENTER, CENTER);
  textSize(24);
  text("WAVE " + level + " CLEARED", width / 2, height / 2 - 30);
  fill(120, 255, 120);
  textSize(14);
  text("Make a wish in the chat panel", width / 2, height / 2 + 10);
  fill(255);
  textSize(12);
  text("(or skip to fight on)", width / 2, height / 2 + 40);
}
```

Replace `checkWinLose()` (currently lines 550–562) with:

```js
function checkWinLose() {
  if (enemies.every((e) => !e.alive)) {
    if (level >= 5) {
      gameState = "victory";
    } else if (window.GENIE_MODE) {
      gameState = "wishing";
      if (genie.onPhaseChange) genie.onPhaseChange("wishing");
    } else {
      startNextWave();
    }
  }
}

// Spawn the next wave. In genie mode genie.js calls this after a wish is
// granted or skipped; in classic mode it runs immediately on wave clear.
function startNextWave() {
  level++;
  spawnEnemies();
  spawnBarriers();
  bullets = [];
  enemyBullets = [];
  gameState = "playing";
  if (genie.onPhaseChange) genie.onPhaseChange("combat");
}
```

(Behavior note: the original incremented `level` first and checked `level > 5`; checking `level >= 5` before incrementing is equivalent — victory after clearing level 5.)

In `keyPressed()` (currently lines 138–157), the `return false` on Space prevents the browser default globally — which would block typing spaces into the chat input during the wish phase. Replace the space branch:

```js
  if (key === " ") {
    if (gameState === "playing") fireBullet();
    // Don't steal Space from the chat input on genie.html.
    if (document.activeElement && document.activeElement.tagName === "INPUT") return;
    return false; // prevent the browser from scrolling on space
  }
```

No change needed for P or R: P only toggles between `playing`/`paused` (so it's inert during `wishing`), and R only fires from end screens.

- [ ] **Step 5: Run both test pages — verify PASS**

Both pages: `RESULT|PASS|...`.

- [ ] **Step 6: Manually verify the classic game**

Open the real page in a browser and play one wave through:

```powershell
Start-Process "C:\Users\jo284142\dhsi\index.html"
```

Expected: plays exactly as before — movement, shooting, pause, instant wave chaining, restart.

- [ ] **Step 7: Commit**

```powershell
git add sketch.js tests/sketch-genie.test.html tests/sketch-classic.test.html
git commit -m "feat: add wishing intermission state and wish hook wiring"
```

---

### Task 4: The Genie Mode page (`genie.html` + `genie.css`)

Static page: game on the left, genie chat panel on the right. No client logic yet (genie.js comes in Task 5 — the `<script src="genie.js">` tag will 404 harmlessly until then).

**Files:**
- Create: `genie.html`
- Create: `genie.css`

- [ ] **Step 1: Write genie.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Space Invaders — Genie Mode</title>
  <link rel="stylesheet" href="genie.css" />
  <script>window.GENIE_MODE = true;</script>
  <script src="https://cdn.jsdelivr.net/npm/p5@1.9.4/lib/p5.min.js"></script>
</head>
<body>
  <main class="genie-layout">
    <section class="game-side">
      <h1>SPACE INVADERS <span class="subtitle">genie mode</span></h1>
      <div id="game-container"></div>
      <p class="instructions">
        &larr; / &rarr; or A / D to move &middot; <strong>Space</strong> to shoot &middot;
        <strong>P</strong> to pause &middot; <strong>R</strong> to restart
      </p>
    </section>
    <aside class="genie-panel">
      <header class="genie-panel__header">
        <h2>&#129502; THE GENIE</h2>
        <p class="genie-status" id="status">connecting&hellip;</p>
      </header>
      <ol class="genie-log" id="log" aria-live="polite"></ol>
      <button class="genie-skip" id="skip" type="button" hidden>
        Skip wish &mdash; start next wave
      </button>
      <form class="genie-form" id="form" autocomplete="off">
        <input class="genie-input" id="input" type="text"
               placeholder="the genie sleeps while you fight&hellip;" disabled />
        <button class="genie-send" id="send" type="submit" disabled>Wish</button>
      </form>
    </aside>
  </main>
  <script src="sketch.js"></script>
  <script src="genie.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write genie.css**

Standalone (does not import `style.css` — the classic page's body-centering would fight the two-column layout). Same palette plus a purple genie accent:

```css
/* Genie Mode: game on the left, genie chat panel on the right. */
:root {
  --bg: #000;
  --fg: #0f0;
  --accent: #ffcc00;
  --genie: #b07fff;
}

* {
  box-sizing: border-box;
}

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: "Courier New", Courier, monospace;
  min-height: 100vh;
}

.genie-layout {
  display: flex;
  gap: 1.5rem;
  justify-content: center;
  align-items: flex-start;
  padding: 1.5rem;
  flex-wrap: wrap;
}

.game-side {
  text-align: center;
}

.game-side h1 {
  letter-spacing: 0.3em;
  margin: 0 0 1rem;
  color: var(--accent);
  text-shadow: 0 0 8px rgba(255, 204, 0, 0.6);
  font-size: 1.4rem;
}

.game-side .subtitle {
  color: var(--genie);
  font-size: 0.8em;
}

#game-container {
  display: inline-block;
  border: 2px solid var(--fg);
  box-shadow: 0 0 20px rgba(0, 255, 0, 0.4);
  line-height: 0;
}

#game-container canvas {
  display: block;
}

.instructions {
  margin-top: 1rem;
  opacity: 0.85;
  font-size: 0.85rem;
}

.genie-panel {
  display: flex;
  flex-direction: column;
  width: min(420px, 95vw);
  height: 640px;
  margin-top: 3.4rem; /* roughly aligns the panel top with the canvas top */
  border: 2px solid var(--genie);
  box-shadow: 0 0 20px rgba(176, 127, 255, 0.4);
  padding: 0.75rem;
  gap: 0.75rem;
}

.genie-panel__header h2 {
  margin: 0;
  color: var(--genie);
  letter-spacing: 0.2em;
  font-size: 1.1rem;
}

.genie-status {
  margin: 0.25rem 0 0;
  font-size: 0.75rem;
  opacity: 0.7;
}

.genie-status--ok {
  color: var(--fg);
}

.genie-status--err {
  color: #ff5050;
}

.genie-log {
  flex: 1;
  overflow-y: auto;
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-size: 0.85rem;
}

.msg {
  padding: 0.4rem 0.6rem;
  border: 1px solid;
  max-width: 90%;
  white-space: pre-wrap;
  word-break: break-word;
}

.msg--user {
  align-self: flex-end;
  border-color: var(--fg);
  color: var(--fg);
}

.msg--genie {
  align-self: flex-start;
  border-color: var(--genie);
  color: #d8c2ff;
}

.msg--system {
  align-self: center;
  border-color: var(--accent);
  color: var(--accent);
  font-size: 0.75rem;
}

.genie-skip {
  background: none;
  border: 2px dashed var(--accent);
  color: var(--accent);
  font-family: inherit;
  padding: 0.5rem;
  cursor: pointer;
}

.genie-skip:hover {
  background: rgba(255, 204, 0, 0.15);
}

.genie-form {
  display: flex;
  gap: 0.5rem;
}

.genie-input {
  flex: 1;
  background: #111;
  border: 1px solid var(--genie);
  color: #fff;
  font-family: inherit;
  padding: 0.5rem;
}

.genie-input:disabled {
  opacity: 0.4;
}

.genie-send {
  background: var(--genie);
  border: none;
  color: #000;
  font-family: inherit;
  font-weight: bold;
  padding: 0.5rem 1rem;
  cursor: pointer;
}

.genie-send:disabled {
  opacity: 0.4;
  cursor: default;
}
```

- [ ] **Step 3: Verify the page renders**

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --virtual-time-budget=5000 --dump-dom "C:\Users\jo284142\dhsi\genie.html" | Select-String -Pattern "canvas|genie-log" | Select-Object -First 4
```

Expected: output contains a `<canvas` element (p5 booted, game running) and the `genie-log` list. Then eyeball it for real:

```powershell
Start-Process "C:\Users\jo284142\dhsi\genie.html"
```

Expected: game playable on the left (R starts it), purple genie panel on the right with status showing an Ollama connection error or "connecting…" (genie.js doesn't exist yet — its 404 is expected; check there are no OTHER console errors).

- [ ] **Step 4: Commit**

```powershell
git add genie.html genie.css
git commit -m "feat: add Genie Mode page layout"
```

---

### Task 5: The genie client (`genie.js`)

The chat client: Ollama streaming (adapted from `chat.js`), the monkey's-paw system prompt, code-block extraction, the grant/retry/fizzle flow, Skip with abort, and phase wiring.

**Files:**
- Create: `genie.js`
- Create: `tests/genie-client.test.html`

- [ ] **Step 1: Write failing unit tests for the pure parts**

Create `tests/genie-client.test.html`. It loads `genie.js` with stub DOM and stub game globals (no p5, no sketch.js, no Ollama), and tests `extractCodeBlock` plus `setPhase` UI toggling:

```html
<!DOCTYPE html>
<html>
<body>
  <!-- Minimal DOM + game stubs so genie.js loads without sketch.js/Ollama -->
  <p id="status"></p>
  <ol id="log"></ol>
  <button id="skip" hidden></button>
  <form id="form"><input id="input" /><button id="send"></button></form>
  <script>
    var genie = {
      hooks: { onUpdate: [], onDraw: [] },
      activeWishes: [],
      onPhaseChange: null,
      onHookError: null,
      applyWish: () => ({ ok: true }),
    };
    var gameState = "start";
    var score = 0, lives = 3, level = 1;
    var config = {};
    function startNextWave() {}
  </script>
  <script src="../genie.js"></script>
  <script src="harness.js"></script>
  <script>
    window.addEventListener("load", () => setTimeout(run, 100));

    function run() {
      check("extractCodeBlock finds a js block", () =>
        extractCodeBlock("Granted!\n```js\nconfig.x = 1;\n```\nEnjoy.") === "config.x = 1;");
      check("extractCodeBlock finds a javascript block", () =>
        extractCodeBlock("```javascript\nlives++;\n```") === "lives++;");
      check("extractCodeBlock finds a bare block", () =>
        extractCodeBlock("```\nscore = 9;\n```") === "score = 9;");
      check("extractCodeBlock takes only the first block", () =>
        extractCodeBlock("```js\nfirst();\n```\nand\n```js\nsecond();\n```") === "first();");
      check("extractCodeBlock returns null without code", () =>
        extractCodeBlock("no wish for you, mortal") === null);
      check("setPhase wishing reveals skip button", () => {
        setPhase("wishing");
        return skipBtn.hidden === false;
      });
      check("setPhase combat hides skip and disables input", () => {
        setPhase("combat");
        return skipBtn.hidden === true && input.disabled === true;
      });
      check("genie.js wired the phase callback", () => genie.onPhaseChange === setPhase);
      report();
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: Run — verify FAIL**

Run the headless command against `tests/genie-client.test.html`. Expected: `RESULT|FAIL|...` (every check fails — `extractCodeBlock is not defined` — or the RESULT line is missing because `genie.js` 404s; either counts as the expected failure).

- [ ] **Step 3: Write genie.js**

Create `genie.js` (complete file). Note the system prompt is built with string concatenation because it must *contain* triple-backtick fences:

```js
// Genie Mode client: a monkey's-paw genie (a local Ollama model) that grants
// one wish per wave by writing JavaScript run against the live game.
// Talks to the game through the `genie` bridge object defined in sketch.js.

const MODEL = "minimax-m3:cloud";
const OLLAMA_BASE = "http://localhost:11434";

const logEl = document.getElementById("log");
const form = document.getElementById("form");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const skipBtn = document.getElementById("skip");
const statusEl = document.getElementById("status");

const FENCE = "```";
const SYSTEM_PROMPT = [
  "You are THE GENIE, a mischievous monkey's-paw genie bound inside a Space",
  "Invaders arcade cabinet. Between waves, the player gets exactly ONE wish.",
  "",
  "PERSONALITY: theatrical, sly, brief. You grant what is asked - but you love",
  "adding a twist or a price ('faster bullets? granted... for BOTH sides').",
  "Keep banter under 60 words. Stay in character. Never mention JavaScript,",
  "code, or being an AI in your banter; the code block is your 'spell'.",
  "",
  "HOW TO GRANT A WISH: include exactly one fenced " + FENCE + "js code block in your",
  "reply. The code runs immediately inside the live game. While the player is",
  "merely chatting or negotiating, reply with banter only - NO code block.",
  "Once you include a code block the wish is spent and the next wave begins.",
  "",
  "THE GAME (p5.js global mode, canvas 480x640, classic Space Invaders).",
  "Mutable tuning object (current values arrive with each message):",
  "  config.playerSpeed, config.bulletSpeed, config.enemyBulletSpeed,",
  "  config.enemyRows, config.enemyCols (these two apply at next wave spawn),",
  "  config.enemyHSpacing, config.enemyVSpacing, config.enemyStartY,",
  "  config.enemyBaseDrop, config.enemyFireChance, config.enemyShootersPerRow",
  "Live state you may read and write:",
  "  player {x,y,w,h} - the ship (y up is negative; canvas origin is top-left)",
  "  enemies [{x,y,w,h,row,col,alive,points,frame}]",
  "  bullets [{x,y,w,h,vy,fromPlayer}], enemyBullets [{x,y,w,h,vy}]",
  "  barriers [{x,y,w,h}], particles, score, lives, level, enemySpeed",
  "Helpers: explode(x, y, r, g, b) spawns a particle burst; fireBullet().",
  "Recurring behaviors: push a function onto genie.hooks.onUpdate (runs every",
  "frame during play - good for movement or spawning logic) or",
  "genie.hooks.onDraw (runs after rendering - you may use p5 drawing calls",
  "like fill, rect, circle, text). Hooks that throw are removed.",
  "p5 globals are available: width, height, frameCount, random(), sin(), cos().",
  "",
  "RULES FOR YOUR SPELL CODE:",
  "- One self-contained snippet of plain JavaScript. No imports, no async.",
  "- Never reassign gameState; never call startNextWave or resetGame.",
  "- Keep the game winnable and losable: lives stays between 1 and 9; never",
  "  remove all enemies; never make the player invincible outright.",
  "- Prefer a felt twist over total chaos: the player should sense the",
  "  monkey's paw, not a broken game.",
].join("\n");

const history = [];
let ollamaUp = false;
let wishSpent = false;
let streaming = false;
let currentAbort = null;

// ---------- Status ----------
async function checkStatus() {
  try {
    const res = await fetch(OLLAMA_BASE + "/api/tags");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    ollamaUp = (data.models || []).some((m) => m.name === MODEL);
    statusEl.classList.remove("genie-status--ok", "genie-status--err");
    if (ollamaUp) {
      statusEl.textContent = "genie awake · " + MODEL;
      statusEl.classList.add("genie-status--ok");
    } else {
      statusEl.textContent =
        'model "' + MODEL + '" not found — run: ollama pull ' + MODEL;
      statusEl.classList.add("genie-status--err");
    }
  } catch {
    ollamaUp = false;
    statusEl.textContent =
      "cannot reach Ollama at " + OLLAMA_BASE + " — wishes disabled";
    statusEl.classList.remove("genie-status--ok");
    statusEl.classList.add("genie-status--err");
  }
}

// ---------- Chat log ----------
function addMessage(role, text) {
  const li = document.createElement("li");
  li.className = "msg msg--" + role;
  li.textContent = text;
  logEl.appendChild(li);
  logEl.scrollTop = logEl.scrollHeight;
  return li;
}

// ---------- Parsing ----------
function extractCodeBlock(text) {
  const m = text.match(/```(?:javascript|js)?[ \t]*\n([\s\S]*?)```/);
  return m ? m[1].trim() : null;
}

// ---------- Game-state snapshot for the prompt ----------
function snapshot() {
  return JSON.stringify({
    score,
    lives,
    level,
    config,
    activeWishes: genie.activeWishes.map((w) => w.text),
  });
}

// ---------- Phase wiring ----------
function setPhase(phase) {
  if (phase === "wishing") {
    wishSpent = false;
    skipBtn.hidden = false;
    checkStatus().then(() => {
      if (gameState === "wishing" && !wishSpent && ollamaUp) {
        input.disabled = false;
        sendBtn.disabled = false;
        input.placeholder = "make a wish…";
        input.focus();
      } else if (!ollamaUp) {
        input.placeholder = "the genie is unreachable — skip to play on";
      }
    });
  } else {
    skipBtn.hidden = true;
    input.disabled = true;
    sendBtn.disabled = true;
    input.placeholder = "the genie sleeps while you fight…";
    input.blur();
  }
}

// ---------- Ollama streaming (NDJSON), adapted from chat.js ----------
async function streamReply(signal) {
  const res = await fetch(OLLAMA_BASE + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
      stream: true,
    }),
    signal,
  });
  if (!res.ok) {
    throw new Error("Ollama " + res.status + ": " + (await res.text()));
  }

  const botEl = addMessage("genie", "");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const chunk = JSON.parse(line);
        const piece = (chunk.message && chunk.message.content) || "";
        if (piece) {
          full += piece;
          botEl.textContent = full;
          logEl.scrollTop = logEl.scrollHeight;
        }
      } catch {
        // Ignore partial / malformed lines; completed on a later chunk.
      }
    }
  }
  return full;
}

// ---------- Wish flow ----------
function beginNextWave(delayMs) {
  setTimeout(() => {
    if (gameState === "wishing") startNextWave();
  }, delayMs);
}

async function grantWish(wishText, code) {
  wishSpent = true;
  let result = genie.applyWish(code);

  if (!result.ok) {
    // One automatic retry: feed the error back to the model.
    addMessage(
      "system",
      "the spell sputters (" + result.error + ") — the genie reweaves it…"
    );
    history.push({
      role: "user",
      content:
        "[Your spell failed with this JavaScript error: " + result.error +
        ". Reply with a single corrected " + FENCE + "js code block - same wish, same twist.]",
    });
    try {
      currentAbort = new AbortController();
      const reply = await streamReply(currentAbort.signal);
      history.push({ role: "assistant", content: reply });
      const code2 = extractCodeBlock(reply);
      result = code2
        ? genie.applyWish(code2)
        : { ok: false, error: "no code block in retry" };
      if (result.ok) code = code2;
    } catch (err) {
      result = { ok: false, error: err.message };
    }
  }

  if (gameState !== "wishing") return; // player skipped while the genie wove

  if (result.ok) {
    genie.activeWishes.push({ text: wishText, code });
    addMessage("system", "✨ wish granted — next wave in 2…");
  } else {
    addMessage("system", "💨 the wish fizzles into smoke. The genie owes you nothing.");
  }
  skipBtn.hidden = true;
  input.disabled = true;
  sendBtn.disabled = true;
  beginNextWave(2000);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || streaming || wishSpent || gameState !== "wishing") return;
  input.value = "";
  addMessage("user", text);
  history.push({
    role: "user",
    content: text + "\n\n[current game state: " + snapshot() + "]",
  });

  streaming = true;
  input.disabled = true;
  sendBtn.disabled = true;
  currentAbort = new AbortController();
  try {
    const reply = await streamReply(currentAbort.signal);
    history.push({ role: "assistant", content: reply });
    const code = extractCodeBlock(reply);
    if (code) await grantWish(text, code);
  } catch (err) {
    if (err.name !== "AbortError") addMessage("system", "⚠️ " + err.message);
  } finally {
    streaming = false;
    currentAbort = null;
    if (!wishSpent && gameState === "wishing" && ollamaUp) {
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }
});

skipBtn.addEventListener("click", () => {
  if (currentAbort) currentAbort.abort(); // a late spell must never land mid-combat
  if (gameState === "wishing") startNextWave();
});

// ---------- Boot ----------
genie.onPhaseChange = setPhase;
genie.onHookError = (msg) =>
  addMessage("system", "⚠️ a spell unraveled mid-flight: " + msg);
checkStatus();
addMessage("system", "Clear a wave to wake the genie.");
```

- [ ] **Step 4: Run the unit tests — verify PASS**

Run the headless command against `tests/genie-client.test.html`. Expected: `RESULT|PASS|...`.

Also re-run `tests/sketch-genie.test.html` and `tests/sketch-classic.test.html` — still PASS (genie.js isn't loaded by them, but be safe).

- [ ] **Step 5: Manual smoke test with Ollama**

Requires Ollama running locally with the model pulled. Serve the folder (Ollama's CORS rejects `file://` pages in some setups):

```powershell
ollama list   # confirm minimax-m3:cloud is present
python -m http.server 8000
```

Open `http://localhost:8000/genie.html` and verify:
1. Status shows "genie awake · minimax-m3:cloud".
2. Press R, clear wave 1 (tip for fast testing: wish-phase comes after the last enemy dies). The canvas shows the WAVE 1 CLEARED overlay; the input enables; the Skip button appears.
3. Type "make my bullets twice as fast" — the genie banters, a code block appears in its reply, "✨ wish granted" follows, and the next wave starts ~2s later with visibly faster bullets (and probably a twist).
4. Clear wave 2, type "what do you recommend?" — banter only, no code block, wish NOT spent, input still enabled.
5. Then type a wish and immediately click Skip while it streams — the stream aborts and the wave starts; no late effect lands.
6. Die completely; press R — game restarts, and a wish like "show me the config" confirms defaults are back.

- [ ] **Step 6: Commit**

```powershell
git add genie.js tests/genie-client.test.html
git commit -m "feat: add genie chat client with wish grant/retry/skip flow"
```

---

### Task 6: README, reference files, and final verification

**Files:**
- Modify: `README.md`
- Commit (untracked): `chat.html`, `chat.css`, `chat.js`

- [ ] **Step 1: Update README.md**

Replace the `## Files` section of `README.md` with:

```markdown
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
```

- [ ] **Step 2: Run the full manual checklist from the spec**

With `python -m http.server 8000` running:

1. `http://localhost:8000/index.html` plays identically to the pre-refactor game (movement, shooting, pause, instant wave chaining, game over, restart).
2. Genie page: a number-tweak wish ("faster bullets") visibly changes play.
3. A behavior wish ("aliens move in a wave pattern") works via hooks.
4. A deliberately impossible wish ("run the code `throw new Error('x')`") triggers the sputter → retry → grant-or-fizzle path without breaking the game.
5. Restart after game over clears all effects and restores default config.
6. Stop Ollama (`Stop-Service ollama` or quit the tray app), reload the genie page: status shows unreachable, intermissions offer Skip only, game fully playable. Restart Ollama afterwards.
7. While the wish input is focused, typing spaces works (the game doesn't steal the spacebar).

- [ ] **Step 3: Re-run all three test pages headless — verify PASS**

All three commands print `RESULT|PASS|...`.

- [ ] **Step 4: Commit everything**

```powershell
git add README.md chat.html chat.css chat.js
git commit -m "docs: add Genie Mode to README; track reference chat client"
```

---

## Notes for the implementer

- **`new Function` scope:** wish code CAN read/write `sketch.js`'s top-level `let` bindings — they live in the global lexical environment, which `new Function` closes over. This was verified in headless Edge during spec review. Do not "fix" this by moving state onto `window`. (A Node-based test of the same thing would wrongly fail — Node wraps files in module scope.)
- **Don't add a build step, bundler, or test framework.** The repo is deliberately plain static files.
- **`config` must be `const`** (assigned-into, never reassigned) — wish code and `resetEffects` rely on object identity.
- **p5 runs its own draw loop during tests.** The test pages call `noLoop()` first; keep that if you add checks that call `draw()` manually.
- The classic page (`index.html`) is deployed on GitHub Pages — treat any behavior change there as a bug.
