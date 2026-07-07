// Service worker: mantém a FILA de downloads. Assim o processo continua mesmo
// com o popup fechado, e lembra o que já está baixando / concluído (evita
// baixar de novo o que já está em andamento).

const jobs = new Map(); // url -> { url, name, state, error }
let concurrency = 4;
let running = 0;

function snapshot() {
  return { concurrency, running, jobs: Array.from(jobs.values()) };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === "getState") {
    sendResponse(snapshot());
    return; // síncrono
  }

  if (msg.type === "setConcurrency") {
    concurrency = clampConc(msg.n);
    pump();
    sendResponse(snapshot());
    return;
  }

  if (msg.type === "enqueue") {
    if (typeof msg.concurrency === "number") concurrency = clampConc(msg.concurrency);
    (msg.items || []).forEach((it) => addJob(it.url, it.name));
    pump();
    sendResponse(snapshot());
    return;
  }

  if (msg.type === "enqueueOne") {
    if (typeof msg.concurrency === "number") concurrency = clampConc(msg.concurrency);
    addJob(msg.url, msg.name);
    pump();
    sendResponse(snapshot());
    return;
  }

  if (msg.type === "clearFinished") {
    for (const [url, j] of jobs) {
      if (j.state === "done" || j.state === "error") jobs.delete(url);
    }
    sendResponse(snapshot());
    return;
  }
});

function clampConc(n) {
  n = parseInt(n, 10);
  if (!Number.isFinite(n) || n < 1) n = 1;
  if (n > 16) n = 16;
  return n;
}

// Adiciona à fila só se ainda não existe, ou se falhou antes (re-tentar).
function addJob(url, name) {
  if (!url) return;
  const existing = jobs.get(url);
  if (existing && existing.state !== "error") return; // já na fila/baixando/pronto
  jobs.set(url, { url, name: name || "", state: "queued", error: "" });
}

// Mantém no máximo `concurrency` downloads ativos (pool rolante).
function pump() {
  for (const job of jobs.values()) {
    if (running >= concurrency) break;
    if (job.state === "queued") {
      job.state = "downloading";
      running++;
      processJob(job).finally(() => {
        running--;
        pump();
      });
    }
  }
}

async function processJob(job) {
  try {
    const direct = await resolveDirectLink(job.url);
    if (!direct) throw new Error("Link direto não encontrado");
    const id = await chrome.downloads.download({ url: direct });
    await waitForDownload(id);
    job.state = "done";
  } catch (e) {
    job.state = "error";
    job.error = e.message || String(e);
  }
}

function waitForDownload(id) {
  return new Promise((resolve, reject) => {
    let settled = false;
    function finish(fn, arg) {
      if (settled) return;
      settled = true;
      chrome.downloads.onChanged.removeListener(onChanged);
      clearInterval(poll);
      fn(arg);
    }
    function onChanged(delta) {
      if (delta.id !== id || !delta.state) return;
      if (delta.state.current === "complete") finish(resolve);
      else if (delta.state.current === "interrupted")
        finish(reject, new Error("interrompido: " + (delta.error ? delta.error.current : "")));
    }
    chrome.downloads.onChanged.addListener(onChanged);

    // Rede de segurança caso o evento não dispare (worker reiniciado etc.)
    const poll = setInterval(check, 1000);
    function check() {
      chrome.downloads.search({ id }, (items) => {
        const it = items && items[0];
        if (!it) return;
        if (it.state === "complete") finish(resolve);
        else if (it.state === "interrupted")
          finish(reject, new Error("interrompido: " + (it.error || "")));
      });
    }
    check();
  });
}

// Baixa o HTML da página do MediaFire e extrai o link real do arquivo.
async function resolveDirectLink(pageUrl) {
  let html;
  try {
    const resp = await fetch(pageUrl, { credentials: "omit" });
    html = await resp.text();
  } catch (e) {
    throw new Error("fetch falhou: " + e.message);
  }

  let m = html.match(/data-scrambled-url\s*=\s*["']([^"']+)["']/i);
  if (m && m[1]) {
    const decoded = tryBase64(m[1]);
    if (decoded && /^https?:\/\//i.test(decoded)) return decoded;
  }

  m = html.match(/id=["']downloadButton["'][^>]*href=["'](https?:\/\/[^"']+)["']/i);
  if (m && m[1]) return m[1];
  m = html.match(/href=["'](https?:\/\/download[^"']+)["'][^>]*id=["']downloadButton["']/i);
  if (m && m[1]) return m[1];

  m = html.match(/https?:\/\/download[0-9]*\.mediafire\.com\/[^\s"'<>\\]+/i);
  if (m && m[0]) return m[0];

  return null;
}

function tryBase64(s) {
  try {
    return atob(s);
  } catch {
    return null;
  }
}
