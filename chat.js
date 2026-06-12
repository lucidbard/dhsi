// Bare-minimum chat client for a local Ollama server.
// Model: minimax-m3:cloud (see README for setup).

const MODEL = "minimax-m3:cloud";
const OLLAMA_URL = "http://localhost:11434/api/chat";

const log = document.getElementById("log");
const form = document.getElementById("form");
const input = document.getElementById("input");
const statusEl = document.getElementById("status");
const sendBtn = form.querySelector("button");

// Rolling conversation history so the model has context.
const history = [];

// Check that Ollama is reachable and the model exists.
async function checkStatus() {
  try {
    const res = await fetch("http://localhost:11434/api/tags");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const haveModel = (data.models || []).some((m) => m.name === MODEL);
    if (haveModel) {
      statusEl.textContent = `connected · model ${MODEL} ready`;
      statusEl.classList.add("chat__status--ok");
    } else {
      statusEl.textContent = `connected, but model "${MODEL}" not found. Run: ollama pull ${MODEL}`;
      statusEl.classList.add("chat__status--err");
    }
  } catch (err) {
    statusEl.textContent = `cannot reach Ollama at ${OLLAMA_URL.replace("/api/chat", "")} — is it running?`;
    statusEl.classList.add("chat__status--err");
  }
}

function addMessage(role, text) {
  const li = document.createElement("li");
  li.className = `msg msg--${role}`;
  li.textContent = text;
  log.appendChild(li);
  log.scrollTop = log.scrollHeight;
  return li;
}

function setBusy(busy) {
  input.disabled = busy;
  sendBtn.disabled = busy;
  if (!busy) input.focus();
}

async function sendMessage(text) {
  addMessage("user", text);
  history.push({ role: "user", content: text });

  const botEl = addMessage("bot", "");
  setBusy(true);

  try {
    const res = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages: history, stream: true }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama ${res.status}: ${errText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullReply = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Ollama streams NDJSON (one JSON object per line).
      let newlineIdx;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;
        try {
          const chunk = JSON.parse(line);
          const piece = chunk.message?.content || "";
          if (piece) {
            fullReply += piece;
            botEl.textContent = fullReply;
            log.scrollTop = log.scrollHeight;
          }
          if (chunk.done) break;
        } catch {
          // Ignore partial / malformed lines; will retry on next chunk.
        }
      }
    }

    history.push({ role: "assistant", content: fullReply });
  } catch (err) {
    botEl.textContent = `⚠️ ${err.message}`;
  } finally {
    setBusy(false);
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  sendMessage(text);
});

checkStatus();
