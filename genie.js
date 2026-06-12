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
  "  player {x,y,w,h} - the ship (canvas origin is top-left, y grows downward)",
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
      } else if (gameState === "wishing" && !ollamaUp) {
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
async function streamReply(signal, extraMessages = []) {
  const res = await fetch(OLLAMA_BASE + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history, ...extraMessages],
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
        if (chunk.error) throw new Error(chunk.error);
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
  if (gameState !== "wishing") return; // skipped before the spell landed
  wishSpent = true;
  let result = genie.applyWish(code);

  if (!result.ok) {
    // One automatic retry: feed the error back to the model.
    addMessage(
      "system",
      "the spell sputters (" + result.error + ") — the genie reweaves it…"
    );
    const retryMsg = {
      role: "user",
      content:
        "[Your spell failed with this JavaScript error: " + result.error +
        ". Reply with a single corrected " + FENCE + "js code block - same wish, same twist.]",
    };
    try {
      currentAbort = new AbortController();
      const reply = await streamReply(currentAbort.signal, [retryMsg]);
      history.push({ role: "assistant", content: reply });
      const code2 = extractCodeBlock(reply);
      if (gameState !== "wishing") return; // skipped while the genie rewove
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
