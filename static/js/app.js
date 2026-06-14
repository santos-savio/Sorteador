/* Logica da UI: carrega estado do backend, renderiza e dispara sorteios. */
(() => {
  const $ = (sel) => document.querySelector(sel);

  const state = { entries: [], config: {}, history: [] };
  const wheel = new Wheel($("#wheel"));

  // Som simples de "tick" via WebAudio (sem arquivos externos).
  let audioCtx = null;
  function tick() {
    if (!state.config.sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = 600;
      o.type = "triangle";
      g.gain.setValueAtTime(0.06, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.05);
      o.connect(g).connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + 0.05);
    } catch (_) { /* ignora */ }
  }
  wheel.onTick = tick;

  // ---------- API ----------
  const api = {
    async get(url) { return (await fetch(url)).json(); },
    async post(url, body) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      return { ok: res.ok, status: res.status, data: await res.json() };
    },
  };

  // ---------- Render ----------
  function render() {
    // titulo
    $("#appTitle").textContent = state.config.title || "Sorteador";

    // textarea
    if (document.activeElement !== $("#entriesText")) {
      $("#entriesText").value = state.entries.map((e) => e.text).join("\n");
    }
    $("#entryCount").textContent = `${state.entries.length} entradas`;

    // config
    $("#cfgDuration").value = state.config.spinDurationMs;
    $("#durLabel").textContent = (state.config.spinDurationMs / 1000).toFixed(1) + "s";
    $("#cfgMode").value = state.config.mode;
    $("#cfgShuffle").checked = !!state.config.shuffleOnSpin;
    $("#cfgSound").checked = !!state.config.sound;

    renderAdvanced();
    renderHistory();
    wheel.setEntries(state.entries);
  }

  function renderAdvanced() {
    const box = $("#advancedList");
    box.innerHTML = "";
    state.entries.forEach((e) => {
      const row = document.createElement("div");
      row.className = "adv-row" + (e.drawn ? " drawn" : "");
      row.innerHTML = `
        <input type="color" value="${e.color}" data-id="${e.id}" data-k="color">
        <input type="text" value="${escapeHtml(e.text)}" data-id="${e.id}" data-k="text">
        <input type="number" min="1" value="${e.weight}" data-id="${e.id}" data-k="weight" title="Peso">
        <label class="muted" style="font-size:12px;display:flex;gap:4px;align-items:center">
          <input type="checkbox" ${e.enabled ? "checked" : ""} data-id="${e.id}" data-k="enabled">ativo
        </label>
        <button class="del" data-id="${e.id}" title="Remover">✕</button>`;
      box.appendChild(row);
    });
  }

  function renderHistory() {
    const ol = $("#historyList");
    ol.innerHTML = "";
    state.history.forEach((h) => {
      const li = document.createElement("li");
      const when = new Date(h.at).toLocaleString("pt-BR");
      li.innerHTML = `<span>${escapeHtml(h.text)}</span><span class="when">${when}</span>`;
      ol.appendChild(li);
    });
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ---------- Acoes ----------
  async function loadState() {
    Object.assign(state, await api.get("/api/state"));
    render();
  }

  async function applyText() {
    const lines = $("#entriesText").value.split("\n").map((l) => l.trim()).filter(Boolean);
    const { data } = await api.post("/api/entries", { entries: lines });
    Object.assign(state, data);
    render();
  }

  // Salva o editor avancado enviando os objetos completos.
  async function saveAdvanced() {
    const { data } = await api.post("/api/entries", { entries: state.entries });
    Object.assign(state, data);
    render();
  }

  async function saveConfig(patch) {
    const { data } = await api.post("/api/config", patch);
    state.config = data;
    render();
  }

  let spinning = false;
  async function spin() {
    if (spinning) return;
    spinning = true;
    setSpinDisabled(true);
    try {
      const { ok, status, data } = await api.post("/api/spin", {});
      if (!ok) {
        alert(data.message || "Nao foi possivel sortear.");
        return;
      }
      // Atualiza entradas (a ordem pode ter mudado se shuffleOnSpin estiver ligado).
      state.entries = data.entries;
      state.history = data.history;
      wheel.setEntries(state.entries);

      // Mapeia o vencedor para o indice entre as fatias visiveis (habilitadas).
      const enabled = state.entries.filter((e) => e.enabled);
      const visIdx = enabled.findIndex((e) => e.id === data.winner.id);

      await wheel.spinTo(visIdx, state.config.spinDurationMs);
      showWinner(data.winner);
      render();
    } finally {
      spinning = false;
      setSpinDisabled(false);
    }
  }

  function setSpinDisabled(v) {
    $("#btnSpin").disabled = v;
    $("#spinCenter").disabled = v;
  }

  function showWinner(entry) {
    $("#winnerName").textContent = entry.text;
    $("#winnerModal").dataset.winnerId = entry.id;
    $("#winnerModal").classList.remove("hidden");
  }

  // ---------- Eventos ----------
  $("#btnSpin").addEventListener("click", spin);
  $("#spinCenter").addEventListener("click", spin);
  $("#btnApplyText").addEventListener("click", applyText);

  // tabs
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.querySelector(`.tab-panel[data-panel="${tab.dataset.tab}"]`).classList.add("active");
    });
  });

  // editor avancado (delegacao)
  $("#advancedList").addEventListener("input", (ev) => {
    const t = ev.target;
    const id = t.dataset.id;
    if (!id) return;
    const entry = state.entries.find((e) => e.id === id);
    if (!entry) return;
    const k = t.dataset.k;
    if (k === "enabled") entry.enabled = t.checked;
    else if (k === "weight") entry.weight = Math.max(1, parseInt(t.value || "1", 10));
    else entry[k] = t.value;
    wheel.setEntries(state.entries);
  });
  $("#advancedList").addEventListener("change", saveAdvanced);
  $("#advancedList").addEventListener("click", async (ev) => {
    if (!ev.target.classList.contains("del")) return;
    const id = ev.target.dataset.id;
    state.entries = state.entries.filter((e) => e.id !== id);
    await saveAdvanced();
  });

  // config
  $("#cfgDuration").addEventListener("input", (e) => {
    $("#durLabel").textContent = (e.target.value / 1000).toFixed(1) + "s";
  });
  $("#cfgDuration").addEventListener("change", (e) =>
    saveConfig({ spinDurationMs: parseInt(e.target.value, 10) }));
  $("#cfgMode").addEventListener("change", (e) => saveConfig({ mode: e.target.value }));
  $("#cfgShuffle").addEventListener("change", (e) => saveConfig({ shuffleOnSpin: e.target.checked }));
  $("#cfgSound").addEventListener("change", (e) => saveConfig({ sound: e.target.checked }));

  // titulo editavel
  $("#appTitle").addEventListener("blur", (e) =>
    saveConfig({ title: e.target.textContent.trim() || "Sorteador" }));

  // topbar
  $("#btnShuffle").addEventListener("click", async () => {
    const { data } = await api.post("/api/shuffle", {});
    state.entries = data;
    render();
  });
  $("#btnExport").addEventListener("click", () => { window.location = "/api/export"; });
  $("#fileImport").addEventListener("change", async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      const { ok, data } = await api.post("/api/import", json);
      if (!ok) { alert("JSON invalido."); return; }
      Object.assign(state, data);
      render();
    } catch (_) { alert("Nao foi possivel ler o arquivo JSON."); }
    ev.target.value = "";
  });
  $("#btnReset").addEventListener("click", async () => {
    if (!confirm("Reiniciar todos os sorteados e limpar o historico?")) return;
    const { data } = await api.post("/api/reset", { clearHistory: true });
    Object.assign(state, data);
    render();
  });
  $("#btnClearHistory").addEventListener("click", async () => {
    const { data } = await api.post("/api/reset", { clearHistory: true });
    Object.assign(state, data);
    render();
  });

  // modal
  $("#btnCloseModal").addEventListener("click", () => $("#winnerModal").classList.add("hidden"));
  $("#btnRemoveWinner").addEventListener("click", async () => {
    const id = $("#winnerModal").dataset.winnerId;
    state.entries = state.entries.filter((e) => e.id !== id);
    await saveAdvanced();
    $("#winnerModal").classList.add("hidden");
  });

  window.addEventListener("resize", () => { wheel._resizeForDPR(); wheel.draw(); });

  loadState();
})();
