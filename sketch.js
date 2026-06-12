// Space Invaders — a classic arcade game in p5.js.
// Controls:
//   Left/Right arrows or A/D : move the player ship
//   Space                    : fire (hold for rapid fire)
//   P                        : pause / resume
//   R                        : restart after game over

// ---------- Game constants ----------
const GAME_WIDTH = 480;
const GAME_HEIGHT = 640;

// Tunable gameplay values. Genie Mode wishes may rewrite these at runtime;
// genie.resetEffects() restores them from DEFAULT_CONFIG.
const DEFAULT_CONFIG = Object.freeze({
  playerSpeed: 7,
  bulletSpeed: 10,
  fireCooldownMs: 250, // min delay between player shots (rapid fire)
  startingLives: 5,
  enemyBulletSpeed: 4,
  enemyRows: 5,
  enemyCols: 8,
  enemyHSpacing: 48,
  enemyVSpacing: 40,
  enemyStartY: 80,
  enemyBaseDrop: 12,
  enemyFireChance: 0.006, // per enemy per frame
  enemyShootersPerRow: 2,
});
const config = { ...DEFAULT_CONFIG };

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
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
  resetEffects() {
    this.hooks.onUpdate.length = 0;
    this.hooks.onDraw.length = 0;
    this.activeWishes.length = 0;
    for (const key of Object.keys(config)) {
      if (!(key in DEFAULT_CONFIG)) delete config[key];
    }
    Object.assign(config, DEFAULT_CONFIG);
  },
};

// Run wish hooks, dropping any that throw so one bad spell can't freeze the game.
function runHooks(list) {
  for (let i = list.length - 1; i >= 0; i--) {
    if (i >= list.length || typeof list[i] !== "function") continue;
    try {
      list[i]();
    } catch (err) {
      list.splice(i, 1);
      if (genie.onHookError) {
        genie.onHookError(err instanceof Error ? err.message : String(err));
      }
    }
  }
}

// ---------- Game state ----------
let player;
let bullets = [];
let enemyBullets = [];
let enemies = [];
let barriers = [];
let particles = [];
let score = 0;
let highScore = 0;
let lives = 3;
let level = 1;
let gameState = "start"; // "start" | "playing" | "paused" | "gameover" | "victory"
let lastShooterPick = 0;
let lastPlayerShot = 0;
let enemyDir = 1; // 1 = right, -1 = left
let enemySpeed = 1;
let stepTick = 0;
let lastStep = 0;
let starField = [];

function setup() {
  const canvas = createCanvas(GAME_WIDTH, GAME_HEIGHT);
  canvas.parent("game-container");
  textFont("Courier New");
  buildStarField();
  resetGame();
}

function buildStarField() {
  starField = [];
  for (let i = 0; i < 80; i++) {
    starField.push({
      x: random(width),
      y: random(height),
      s: random(1, 2.5),
    });
  }
}

function resetGame() {
  genie.resetEffects();
  player = {
    x: width / 2,
    y: height - 40,
    w: 36,
    h: 20,
  };
  bullets = [];
  enemyBullets = [];
  particles = [];
  barriers = [];
  enemies = [];
  score = 0;
  lives = config.startingLives;
  level = 1;
  enemyDir = 1;
  enemySpeed = 1;
  spawnEnemies();
  spawnBarriers();
}

function spawnEnemies() {
  enemies = [];
  // Early waves start smaller: 3 rows on wave 1, 4 on wave 2, full size after.
  const rows = Math.max(1, config.enemyRows - Math.max(0, 3 - level));
  const startX = (width - (config.enemyCols - 1) * config.enemyHSpacing) / 2;
  for (let r = 0; r < rows; r++) {
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

function spawnBarriers() {
  barriers = [];
  const segW = 6;
  const segH = 6;
  const pattern = [
    " ###### ",
    " ###### ",
    " ###### ",
    " ##  ## ",
    " ##  ## ",
    " ##  ## ",
  ];
  const positions = [width * 0.2, width * 0.5, width * 0.8];
  for (const cx of positions) {
    const baseX = cx - (pattern[0].length * segW) / 2;
    const baseY = height - 150;
    for (let r = 0; r < pattern.length; r++) {
      for (let c = 0; c < pattern[r].length; c++) {
        if (pattern[r][c] === "#") {
          barriers.push({
            x: baseX + c * segW,
            y: baseY + r * segH,
            w: segW,
            h: segH,
          });
        }
      }
    }
  }
}

// ---------- Input ----------
const keys = {};
function keyPressed() {
  keys[keyCode] = true;
  if (key === " ") {
    // Don't steal Space from the chat input on genie.html.
    if (document.activeElement && document.activeElement.tagName === "INPUT") return;
    if (gameState === "playing") fireBullet();
    return false; // prevent the browser from scrolling on space
  }
  if (key === "p" || key === "P") {
    if (gameState === "playing") gameState = "paused";
    else if (gameState === "paused") gameState = "playing";
  }
  if (key === "r" || key === "R") {
    if (gameState === "start" || gameState === "gameover" || gameState === "victory") {
      level = 1;
      resetGame();
      gameState = "playing";
    }
  }
}
function keyReleased() {
  keys[keyCode] = false;
}

function fireBullet() {
  // Rapid fire: a short cooldown instead of the classic one-bullet limit.
  if (millis() - lastPlayerShot < config.fireCooldownMs) return;
  lastPlayerShot = millis();
  bullets.push({
    x: player.x,
    y: player.y - player.h / 2,
    w: 3,
    h: 10,
    vy: -config.bulletSpeed,
    fromPlayer: true,
  });
}

function enemyFire() {
  // Pick a few random alive enemies from the bottom-most alive in each column
  // and let one of them shoot at random. We just sample a few alive enemies.
  const alive = enemies.filter((e) => e.alive);
  if (!alive.length) return;
  // Prefer enemies in lower rows by weighting the sample.
  const shooters = [];
  for (let i = 0; i < config.enemyShootersPerRow; i++) {
    const pick = random(alive);
    shooters.push(pick);
  }
  for (const s of shooters) {
    if (random() < config.enemyFireChance) {
      enemyBullets.push({
        x: s.x,
        y: s.y + s.h / 2,
        w: 3,
        h: 10,
        vy: config.enemyBulletSpeed,
      });
    }
  }
}

// ---------- Update loop ----------
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

function drawStarField() {
  background(0);
  noStroke();
  fill(255, 255, 255, 180);
  for (const s of starField) {
    circle(s.x, s.y, s.s);
  }
}

function drawStartScreen() {
  fill(255, 204, 0);
  textAlign(CENTER, CENTER);
  textSize(28);
  text("SPACE INVADERS", width / 2, height / 2 - 60);
  fill(0, 255, 0);
  textSize(14);
  text(
    "Move: Left / Right arrows or A / D\nShoot: Space\nPause: P    Restart: R",
    width / 2,
    height / 2
  );
  fill(255);
  textSize(12);
  text("Press R to start", width / 2, height / 2 + 80);
}

function drawPaused() {
  fill(0, 0, 0, 180);
  rect(0, 0, width, height);
  fill(255, 204, 0);
  textAlign(CENTER, CENTER);
  textSize(32);
  text("PAUSED", width / 2, height / 2);
  fill(255);
  textSize(12);
  text("Press P to resume", width / 2, height / 2 + 40);
}

function drawGameOver() {
  fill(0, 0, 0, 200);
  rect(0, 0, width, height);
  fill(255, 60, 60);
  textAlign(CENTER, CENTER);
  textSize(36);
  text("GAME OVER", width / 2, height / 2 - 20);
  fill(255);
  textSize(14);
  text("Final score: " + score, width / 2, height / 2 + 20);
  text("Press R to play again", width / 2, height / 2 + 60);
}

function drawVictory() {
  fill(0, 0, 0, 200);
  rect(0, 0, width, height);
  fill(120, 255, 120);
  textAlign(CENTER, CENTER);
  textSize(32);
  text("VICTORY!", width / 2, height / 2 - 20);
  fill(255);
  textSize(14);
  text("Level cleared. Press R for the next wave.", width / 2, height / 2 + 20);
}

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

function updatePlayer() {
  if (keys[LEFT_ARROW] || keys[65]) {
    player.x -= config.playerSpeed;
  }
  if (keys[RIGHT_ARROW] || keys[68]) {
    player.x += config.playerSpeed;
  }
  if (keys[32]) fireBullet(); // hold Space for auto-fire
  player.x = constrain(player.x, player.w / 2, width - player.w / 2);
}

function updateBullets() {
  for (const b of bullets) b.y += b.vy;
  for (const b of enemyBullets) b.y += b.vy;
  bullets = bullets.filter((b) => b.y > -20 && b.y < height + 20);
  enemyBullets = enemyBullets.filter((b) => b.y > -20 && b.y < height + 20);
}

function updateEnemies() {
  const alive = enemies.filter((e) => e.alive);
  if (!alive.length) return;

  // Step in time with a classic 4-frame march; speed up as fewer remain.
  const interval = map(alive.length, 1, enemies.length, 80, 320);
  if (millis() - lastStep > interval) {
    lastStep = millis();
    stepTick++;
    let hitEdge = false;
    for (const e of alive) {
      e.x += enemyDir * 10 * enemySpeed;
      e.frame = (e.frame + 1) % 2;
      if (e.x - e.w / 2 < 0 || e.x + e.w / 2 > width) hitEdge = true;
    }
    if (hitEdge) {
      enemyDir *= -1;
      for (const e of alive) {
        e.y += config.enemyBaseDrop;
      }
      enemySpeed += 0.15;
    }
  }
}

function drawPlayer() {
  // Simple ship: triangle on top of a rectangle.
  fill(0, 255, 0);
  noStroke();
  rectMode(CENTER);
  rect(player.x, player.y, player.w, player.h);
  triangle(
    player.x - player.w / 2,
    player.y + player.h / 2,
    player.x + player.w / 2,
    player.y + player.h / 2,
    player.x,
    player.y - player.h
  );
}

function drawBullets() {
  noStroke();
  fill(255, 255, 255);
  rectMode(CENTER);
  for (const b of bullets) rect(b.x, b.y, b.w, b.h);
  fill(255, 80, 80);
  for (const b of enemyBullets) rect(b.x, b.y, b.w, b.h);
}

function drawEnemies() {
  rectMode(CENTER);
  for (const e of enemies) {
    if (!e.alive) continue;
    // Color by row (top = red, middle = yellow, bottom = cyan — arcade palette).
    const palette = [
      [255, 80, 80],
      [255, 200, 80],
      [80, 200, 255],
      [80, 255, 120],
      [200, 120, 255],
    ];
    const col = palette[e.row % palette.length];
    fill(col[0], col[1], col[2]);
    noStroke();
    drawEnemyShape(e);
  }
}

function drawEnemyShape(e) {
  // Crude pixel-art enemy that wobbles on the 2-frame step.
  const t = stepTick % 2;
  const x = e.x;
  const y = e.y;
  const w = e.w;
  const h = e.h;
  // Body block
  rect(x, y, w * 0.9, h * 0.6);
  // Two top "antennae"
  const antW = 4;
  if (t === 0) {
    rect(x - w / 2 + 4, y - h / 2, antW, 4);
    rect(x + w / 2 - 8, y - h / 2, antW, 4);
  } else {
    rect(x - w / 2 + 8, y - h / 2, antW, 4);
    rect(x + w / 2 - 4, y - h / 2, antW, 4);
  }
  // Legs
  rect(x - w / 2, y + h / 2 - 4, 4, 6);
  rect(x, y + h / 2 - 4, 4, 6);
  rect(x + w / 2 - 4, y + h / 2 - 4, 4, 6);
}

function drawBarriers() {
  noStroke();
  fill(0, 255, 0);
  rectMode(CORNER);
  for (const b of barriers) rect(b.x, b.y, b.w, b.h);
}

function drawParticles() {
  noStroke();
  for (const p of particles) {
    fill(p.r, p.g, p.b, p.a);
    circle(p.x, p.y, p.s);
  }
}

function drawHUD() {
  rectMode(CORNER);
  fill(0);
  rect(0, 0, width, 24);
  fill(0, 255, 0);
  textSize(14);
  textAlign(LEFT, TOP);
  text("SCORE " + score, 8, 5);
  textAlign(CENTER, TOP);
  text("LIVES " + lives, width / 2, 5);
  textAlign(RIGHT, TOP);
  text("HI " + highScore, width - 8, 5);
}

function updateParticles() {
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.1;
    p.a -= 6;
  }
  particles = particles.filter((p) => p.a > 0);
}

function explode(x, y, r, g, b) {
  for (let i = 0; i < 14; i++) {
    particles.push({
      x,
      y,
      vx: random(-2, 2),
      vy: random(-3, 0),
      s: random(2, 4),
      r,
      g,
      b,
      a: 255,
    });
  }
}

function checkCollisions() {
  // Player bullets vs enemies
  for (const b of bullets) {
    if (!b.fromPlayer) continue;
    for (const e of enemies) {
      if (!e.alive) continue;
      if (rectsOverlap(b, e)) {
        e.alive = false;
        b.y = -9999; // mark for cleanup
        score += e.points;
        highScore = max(highScore, score);
        explode(e.x, e.y, 255, 200, 80);
        break;
      }
    }
  }

  // Player bullets vs barriers
  for (const b of bullets) {
    if (!b.fromPlayer) continue;
    for (const br of barriers) {
      if (rectsOverlap(b, br)) {
        b.y = -9999;
        br.x = -9999; // remove the block
        explode(b.x, b.y, 0, 255, 0);
        break;
      }
    }
  }
  barriers = barriers.filter((b) => b.x > -100);

  // Enemy bullets vs player
  for (const b of enemyBullets) {
    if (rectsOverlap(b, player)) {
      b.y = height + 9999;
      lives--;
      explode(player.x, player.y, 0, 255, 0);
      if (lives <= 0) {
        gameState = "gameover";
      } else {
        // Reset ship position
        player.x = width / 2;
      }
    }
  }

  // Enemy bullets vs barriers
  for (const b of enemyBullets) {
    for (const br of barriers) {
      if (rectsOverlap(b, br)) {
        b.y = height + 9999;
        br.x = -9999;
        explode(b.x, b.y, 0, 255, 0);
        break;
      }
    }
  }
  barriers = barriers.filter((b) => b.x > -100);

  // Enemies vs player (reached the bottom row) — instant game over.
  for (const e of enemies) {
    if (!e.alive) continue;
    if (e.y + e.h / 2 >= player.y - player.h) {
      lives = 0;
      gameState = "gameover";
      explode(e.x, e.y, 255, 60, 60);
    }
  }
}

function rectsOverlap(a, b) {
  rectMode(CENTER);
  return (
    a.x + a.w / 2 > b.x - b.w / 2 &&
    a.x - a.w / 2 < b.x + b.w / 2 &&
    a.y + a.h / 2 > b.y - b.h / 2 &&
    a.y - a.h / 2 < b.y + b.h / 2
  );
}

function checkWinLose() {
  if (gameState !== "playing") return;
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

// Expose the millis-driven shooter tick (currently inline above).
function touchStarted() {
  // Touch support: tap the left/right halves of the canvas to move,
  // tap the center to fire.
  if (gameState === "start" || gameState === "gameover" || gameState === "victory") {
    level = 1;
    resetGame();
    gameState = "playing";
    return false;
  }
  if (gameState === "playing") {
    if (mouseX < width / 3) {
      player.x -= 30;
    } else if (mouseX > (2 * width) / 3) {
      player.x += 30;
    } else {
      fireBullet();
    }
  }
  return false;
}
