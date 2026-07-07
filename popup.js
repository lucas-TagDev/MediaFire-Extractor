const scanBtn = document.getElementById("scanBtn");
const downloadAllBtn = document.getElementById("downloadAllBtn");
const listEl = document.getElementById("list");
const countEl = document.getElementById("count");
const statusEl = document.getElementById("status");
const concurrencyEl = document.getElementById("concurrency");

let links = []; // { url, name, el }
const byUrl = new Map(); // url -> link obj
let pollTimer = null;

function setStatus(msg, type = "") {
  statusEl.textContent = msg || "";
  statusEl.className = "status" + (type ? " " + type : "");
}

function getConcurrency() {
  let n = parseInt(concurrencyEl.value, 10);
  if (!Number.isFinite(n) || n < 1) n = 1;
  if (n > 16) n = 16;
  concurrencyEl.value = n;
  return n;
}

// --- Coleta de links (roda na página) ---
function collectMediaFireLinks() {
  const set = new Map();
  const re = /mediafire\.com\/(file|download|\?|view)/i;
  document.querySelectorAll("a[href]").forEach((a) => {
    const href = a.href;
    if (/https?:\/\/(www\.)?mediafire\.com\//i.test(href) && re.test(href)) {
      if (!set.has(href)) set.set(href, (a.textContent || "").trim().slice(0, 80));
    }
  });
  const text = document.body ? document.body.innerText : "";
  const rx = /https?:\/\/(?:www\.)?mediafire\.com\/(?:file|download|view)\/[^\s"'<>]+/gi;
  let m;
  while ((m = rx.exec(text)) !== null) {
    if (!set.has(m[0])) set.set(m[0], "");
  }
  return Array.from(set, ([url, name]) => ({ url, name }));
}

function nameFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    return decodeURIComponent(parts[parts.length - 1] || u.hostname);
  } catch {
    return url;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function render() {
  listEl.innerHTML = "";
  byUrl.clear();
  countEl.textContent = links.length + (links.length === 1 ? " link" : " links");
  downloadAllBtn.disabled = links.length === 0;

  if (links.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Nenhum link do MediaFire encontrado nesta página.";
    listEl.appendChild(li);
    return;
  }

  links.forEach((item) => {
    const li = document.createElement("li");
    li.className = "item";
    li.innerHTML = `
      <div class="info">
        <div class="name">${escapeHtml(item.name || nameFromUrl(item.url))}</div>
        <div class="url">${escapeHtml(item.url)}</div>
      </div>
      <button class="dl">Baixar</button>`;
    li.querySelector(".dl").addEventListener("click", () => downloadOne(item.url));
    item.el = li;
    byUrl.set(item.url, item);
    listEl.appendChild(li);
  });
}

// Aplica o estado vindo do background em cada item.
function applyState(state) {
  if (!state || !state.jobs) return;
  const jobMap = new Map(state.jobs.map((j) => [j.url, j]));
  let done = 0, err = 0, active = 0, queued = 0;

  byUrl.forEach((item, url) => {
    const j = jobMap.get(url);
    const btn = item.el.querySelector(".dl");
    if (!j) {
      item.el.className = "item";
      btn.textContent = "Baixar";
      btn.disabled = false;
      return;
    }
    if (j.state === "done") {
      item.el.className = "item done";
      btn.textContent = "OK"; btn.disabled = true; done++;
    } else if (j.state === "error") {
      item.el.className = "item error";
      btn.textContent = "Repetir"; btn.disabled = false; err++;
    } else if (j.state === "downloading") {
      item.el.className = "item loading";
      btn.textContent = "Baixando..."; btn.disabled = true; active++;
    } else { // queued
      item.el.className = "item loading";
      btn.textContent = "Na fila"; btn.disabled = true; queued++;
    }
  });

  const totalTracked = done + err + active + queued;
  if (totalTracked > 0) {
    setStatus(
      `${active} baixando, ${queued} na fila, ${done} ok, ${err} erro`,
      err ? "error" : (active + queued === 0 ? "ok" : "")
    );
  }
}

async function refreshState() {
  try {
    const state = await chrome.runtime.sendMessage({ type: "getState" });
    applyState(state);
  } catch (e) {
    // background pode estar reiniciando; ignora
  }
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(refreshState, 1000);
}

async function downloadOne(url) {
  const item = byUrl.get(url);
  if (item) {
    item.el.className = "item loading";
    item.el.querySelector(".dl").textContent = "Na fila";
  }
  await chrome.runtime.sendMessage({
    type: "enqueueOne",
    url,
    name: item ? item.name : "",
    concurrency: getConcurrency(),
  });
  startPolling();
  refreshState();
}

async function downloadAll() {
  if (links.length === 0) return;
  await chrome.runtime.sendMessage({
    type: "enqueue",
    items: links.map((l) => ({ url: l.url, name: l.name })),
    concurrency: getConcurrency(),
  });
  startPolling();
  refreshState();
}

async function scan() {
  setStatus("Escaneando...");
  scanBtn.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error("Aba não encontrada.");
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectMediaFireLinks,
    });
    links = (results && results[0] && results[0].result) || [];
    render();
    if (links.length) {
      setStatus(`${links.length} link(s) encontrado(s).`, "ok");
    } else {
      setStatus("Nenhum link encontrado.");
    }
    // reflete imediatamente o que já está na fila do background
    refreshState();
    startPolling();
  } catch (e) {
    setStatus("Erro ao escanear: " + e.message, "error");
  } finally {
    scanBtn.disabled = false;
  }
}

concurrencyEl.addEventListener("change", () => {
  chrome.runtime.sendMessage({ type: "setConcurrency", n: getConcurrency() });
});

scanBtn.addEventListener("click", scan);
downloadAllBtn.addEventListener("click", downloadAll);

scan();
