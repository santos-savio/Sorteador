/* Logica da UI: carrega estado do localStorage, renderiza e dispara sorteios. */
(() => {
  const $ = (sel) => document.querySelector(sel);

  // ---------- Gerenciamento de estado (localStorage) ----------
  const DEFAULT_PALETTE = [
    "#e74c3c", "#e67e22", "#f1c40f", "#2ecc71", "#1abc9c",
    "#3498db", "#9b59b6", "#34495e", "#e84393", "#00cec9",
  ];
  const STORAGE_KEY = "sorteador_state";
  const HISTORY_LIMIT = 200;

  function newUUID() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function nowIso() { return new Date().toISOString(); }

  function makeEntry(text, index = 0, color = null) {
    return {
      id: newUUID(),
      text,
      color: color || DEFAULT_PALETTE[index % DEFAULT_PALETTE.length],
      weight: 1,
      enabled: true,
      drawn: false,
    };
  }

  function defaultConfig() {
    return { spinDurationMs: 6000, mode: "repeat", shuffleOnSpin: false, sound: true, title: "Sorteador" };
  }

  function defaultState() {
    return {
      entries: ["Ana", "Bruno", "Carla", "Diego", "Eva", "Felipe"].map((n, i) => makeEntry(n, i)),
      config: defaultConfig(),
      history: [],
    };
  }

  function normalizeState(data) {
    const out = defaultState();
    Object.assign(out.config, data.config || {});
    out.history = Array.isArray(data.history) ? data.history : [];
    const entries = (data.entries || []).map((e, i) => {
      const text = String(e.text || "").trim();
      if (!text) return null;
      return {
        id: String(e.id || newUUID()),
        text,
        color: (typeof e.color === "string" && e.color) || DEFAULT_PALETTE[i % DEFAULT_PALETTE.length],
        weight: Math.max(1, parseInt(e.weight || 1, 10)),
        enabled: e.enabled !== false,
        drawn: !!e.drawn,
      };
    }).filter(Boolean);
    if (entries.length) out.entries = entries;
    return out;
  }

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalizeState(JSON.parse(raw));
    } catch (_) {}
    return defaultState();
  }

  function saveToStorage() {
    try {
      if (state.history.length > HISTORY_LIMIT) state.history = state.history.slice(0, HISTORY_LIMIT);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  // ---------- Sorteio (client-side) ----------
  function eligibleIndices() {
    const mode = state.config.mode || "repeat";
    return state.entries.reduce((acc, e, i) => {
      if (!e.enabled) return acc;
      if (mode === "unique" && e.drawn) return acc;
      acc.push(i);
      return acc;
    }, []);
  }

  function weightedChoice(idxs, weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < idxs.length; i++) {
      r -= weights[i];
      if (r <= 0) return idxs[i];
    }
    return idxs[idxs.length - 1];
  }

  function performSpin() {
    if (state.config.shuffleOnSpin) state.entries.sort(() => Math.random() - 0.5);
    const idxs = eligibleIndices();
    if (!idxs.length) return null;
    const weights = idxs.map(i => Math.max(1, parseInt(state.entries[i].weight || 1, 10)));
    const winnerIdx = weightedChoice(idxs, weights);
    const entry = state.entries[winnerIdx];

    // Snapshot da roda antes de marcar como sorteado (para a animacao).
    const spinEntries = state.entries.filter(e => e.enabled && !e.drawn).map(e => ({ ...e }));
    const visibleIndex = spinEntries.findIndex(e => e.id === entry.id);

    state.history.unshift({ id: newUUID(), entryId: entry.id, text: entry.text, at: nowIso() });
    if (state.config.mode === "unique") entry.drawn = true;
    saveToStorage();

    return { winner: { ...entry }, visibleIndex, spinEntries };
  }

  // ---------- Estado e roda ----------
  const state = { entries: [], config: {}, history: [] };
  const wheel = new Wheel($("#wheel"));

  // ---------- Modo projecao / controle ----------
  // A janela com ?mode=projection mostra so a roda em tela cheia (sem config).
  // A janela principal que a abriu vira "controle" e comanda via BroadcastChannel.
  const params = new URLSearchParams(location.search);
  const isProjection = params.get("mode") === "projection";

  // Token unico por roleta: isola a comunicacao entre cada controle e a SUA
  // projecao. Assim, varias roletas abertas (abas/janelas) nao interferem
  // umas nas outras. A projecao herda o token do controle via URL; o controle
  // mantem o token na sessionStorage para sobreviver a um reload.
  const wheelToken = isProjection
    ? (params.get("token") || "default")
    : (sessionStorage.getItem("wheelToken") || (() => {
        const t = newUUID();
        sessionStorage.setItem("wheelToken", t);
        return t;
      })());

  // Canal exclusivo desta roleta (o nome carrega o token).
  const channel = ("BroadcastChannel" in window)
    ? new BroadcastChannel("sorteador:" + wheelToken)
    : null;

  // Envia uma mensagem carimbada com o token desta roleta.
  function send(msg) {
    if (channel) channel.postMessage({ ...msg, token: wheelToken });
  }

  let projectionWin = null;   // referencia da janela de projecao (na janela de controle)
  let spinFallback = null;    // timeout de seguranca ao delegar o giro
  let pendingHistory = null;  // historico retido ate a roleta parar (modo controlador)

  function controllerActive() {
    return !isProjection && projectionWin && !projectionWin.closed;
  }

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

  // ---------- Render ----------
  // syncWheel=false mantem a roda como esta (usado apos o giro, para so remover
  // o sorteado quando o modal do vencedor for fechado).
  function render(syncWheel = true) {
    $("#appTitle").textContent = state.config.title || "Sorteador";

    if (document.activeElement !== $("#entriesText")) {
      $("#entriesText").value = state.entries.map((e) => e.text).join("\n");
    }
    const avail = state.entries.filter((e) => e.enabled && !e.drawn).length;
    $("#entryCount").textContent = `${state.entries.length} entradas · ${avail} na roda`;

    $("#cfgDuration").value = state.config.spinDurationMs;
    $("#durLabel").textContent = (state.config.spinDurationMs / 1000).toFixed(1) + "s";
    $("#cfgMode").value = state.config.mode;
    $("#cfgShuffle").checked = !!state.config.shuffleOnSpin;
    $("#cfgSound").checked = !!state.config.sound;

    renderAdvanced();
    renderHistory();
    if (syncWheel) wheel.setEntries(state.entries);
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
  function loadState() {
    Object.assign(state, loadFromStorage());
    render();
    if (isProjection) { wheel._resizeForDPR(); wheel.draw(); }
  }

  function pushRefresh() {
    if (controllerActive()) send({ type: "refresh" });
  }

  function applyText() {
    const lines = $("#entriesText").value.split("\n").map((l) => l.trim()).filter(Boolean);
    const existing = {};
    state.entries.forEach(e => { existing[e.text] = e; });
    state.entries = lines.map((text, i) => existing[text] ? { ...existing[text] } : makeEntry(text, i));
    saveToStorage();
    render();
    pushRefresh();
  }

  function saveAdvanced() {
    saveToStorage();
    render();
    pushRefresh();
  }

  function saveConfig(patch) {
    if ("spinDurationMs" in patch)
      state.config.spinDurationMs = Math.max(500, Math.min(60000, parseInt(patch.spinDurationMs, 10)));
    if ("mode" in patch && (patch.mode === "repeat" || patch.mode === "unique"))
      state.config.mode = patch.mode;
    if ("shuffleOnSpin" in patch) state.config.shuffleOnSpin = !!patch.shuffleOnSpin;
    if ("sound" in patch) state.config.sound = !!patch.sound;
    if ("title" in patch) state.config.title = String(patch.title).slice(0, 120);
    saveToStorage();
    render();
    pushRefresh();
  }

  // ---------- Giro ----------
  let spinning = false;

  function setSpinDisabled(v) {
    ["#btnSpin", "#spinCenter", "#ctrlSpin"].forEach((s) => {
      const el = $(s);
      if (el) el.disabled = v;
    });
  }

  async function spin() {
    if (spinning) return;
    spinning = true;
    setSpinDisabled(true);
    let delegated = false;
    try {
      const result = performSpin();
      if (!result) {
        alert("Nenhum candidato disponivel. No modo exclusivo, reinicie os sorteados.");
        return;
      }
      if (controllerActive()) {
        // Delega a animacao para a janela de projecao.
        delegated = true;
        // O historico ja foi atualizado por performSpin; retemos ate a animacao terminar.
        const newHistory = state.history;
        state.history = state.history.slice(1);
        pendingHistory = newHistory;
        send({
          type: "spin",
          winner: result.winner,
          visibleIndex: result.visibleIndex,
          spinEntries: result.spinEntries,
          entries: state.entries,
          history: newHistory,
          durationMs: state.config.spinDurationMs,
        });
        clearTimeout(spinFallback);
        spinFallback = setTimeout(() => {
          // Fallback: se a projecao nao responder, aplica o historico pendente.
          if (pendingHistory) { state.history = pendingHistory; pendingHistory = null; renderHistory(); }
          spinning = false;
          setSpinDisabled(false);
        }, state.config.spinDurationMs + 5000);
        render();
      } else {
        // Anima localmente (janela normal ou a propria projecao).
        wheel.setEntries(result.spinEntries);
        await wheel.spinTo(result.visibleIndex, state.config.spinDurationMs);
        showWinner(result.winner);
        render(false); // mantem o vencedor na roda ate fechar o modal
        // Se o giro partiu da projecao, avisa o controle para sincronizar.
        if (isProjection) send({ type: "refresh" });
      }
    } finally {
      if (!delegated) {
        spinning = false;
        setSpinDisabled(false);
      }
    }
  }

  // Executa o giro na janela de projecao a partir do comando do controle.
  async function doProjectionSpin(m) {
    if (spinning) return;
    spinning = true;
    wheel.setEntries(m.spinEntries);
    await wheel.spinTo(m.visibleIndex, m.durationMs);
    state.entries = m.entries;
    state.history = m.history;
    showWinner(m.winner);
    render(false); // mantem o vencedor na roda ate fechar o modal
    spinning = false;
    send({ type: "winner-shown" });
  }

  function showWinner(entry) {
    $("#winnerName").textContent = entry.text;
    $("#winnerModal").dataset.winnerId = entry.id;
    $("#winnerModal").classList.remove("hidden");
  }

  function closeWinner() {
    $("#winnerModal").classList.add("hidden");
    wheel.setEntries(state.entries); // so agora o sorteado sai da roda
    if (controllerActive()) send({ type: "close-modal" });
  }

  // ---------- Tela cheia (projecao) ----------
  function tryFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    }
  }

  // ---------- Mensagens entre janelas ----------
  if (channel) {
    channel.onmessage = (ev) => {
      const m = ev.data || {};
      // Ignora mensagens de outra roleta (protecao extra alem do canal isolado).
      if (m.token && m.token !== wheelToken) return;
      if (isProjection) {
        if (m.type === "spin") doProjectionSpin(m);
        else if (m.type === "close-modal") {
          $("#winnerModal").classList.add("hidden");
          wheel.setEntries(state.entries); // remove o sorteado da roda na projecao
        }
        else if (m.type === "refresh") loadState();
      } else if (m.type === "winner-shown") {
        clearTimeout(spinFallback);
        if (pendingHistory) { state.history = pendingHistory; pendingHistory = null; renderHistory(); }
        spinning = false;
        setSpinDisabled(false);
      } else if (m.type === "refresh") {
        // A projecao sorteou por conta propria: sincroniza lista/historico.
        loadState();
      }
    };
  }

  // ---------- Eventos ----------
  $("#btnSpin").addEventListener("click", spin);
  $("#spinCenter").addEventListener("click", spin);
  $("#btnApplyText").addEventListener("click", applyText);

  // Painel de controle
  $("#ctrlSpin").addEventListener("click", spin);
  $("#ctrlCloseWinner").addEventListener("click", closeWinner);
  $("#ctrlEnd").addEventListener("click", () => {
    if (projectionWin && !projectionWin.closed) projectionWin.close();
    projectionWin = null;
    document.body.classList.remove("controller-mode");
  });

  // ---------- Dropdown tela cheia ----------
  function toggleFsMenu(e) {
    e.stopPropagation();
    $("#fsMenu").classList.toggle("hidden");
  }
  function closeFsMenu() { $("#fsMenu").classList.add("hidden"); }
  $("#btnFullscreen").addEventListener("click", toggleFsMenu);
  document.addEventListener("click", closeFsMenu);
  $("#fsMenu").addEventListener("click", (e) => e.stopPropagation());

  // Opcao 1: tela cheia unica (mesma janela, sem config)
  function enterSingleFs() {
    closeFsMenu();
    document.body.classList.add("single-fs-mode");
    $("#btnExitSingle").classList.remove("hidden");
    document.documentElement.requestFullscreen?.().catch(() => {});
    // Recalcula canvas apos transicao de layout
    requestAnimationFrame(() => { wheel._resizeForDPR(); wheel.draw(); });
  }
  function exitSingleFs() {
    document.body.classList.remove("single-fs-mode");
    $("#btnExitSingle").classList.add("hidden");
    if (document.fullscreenElement) document.exitFullscreen?.();
    wheel._resizeForDPR();
    wheel.draw();
  }
  $("#btnFsSingle").addEventListener("click", enterSingleFs);
  $("#btnExitSingle").addEventListener("click", exitSingleFs);
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && document.body.classList.contains("single-fs-mode")) {
      exitSingleFs();
    }
  });

  // Opcao 2: tela cheia + controles (projecao em nova janela)
  function openProjection() {
    closeFsMenu();
    if (controllerActive()) { projectionWin.focus(); return; }
    const url = location.pathname + "?mode=projection&token=" + encodeURIComponent(wheelToken);
    projectionWin = window.open(url, "sorteador_projecao_" + wheelToken);
    if (!projectionWin) {
      alert("Permita pop-ups para abrir a janela de projecao.");
      return;
    }
    const status = document.querySelector(".ctrl-status");
    if (status) status.textContent = `🖥 Projeção ativa · roleta #${wheelToken.slice(0, 4)}`;
    document.body.classList.add("controller-mode");
    setTimeout(pushRefresh, 800);
  }
  $("#btnFsProjection").addEventListener("click", openProjection);

  // Sai do modo controle se a projecao for fechada manualmente
  setInterval(() => {
    if (document.body.classList.contains("controller-mode") &&
        (!projectionWin || projectionWin.closed)) {
      document.body.classList.remove("controller-mode");
      projectionWin = null;
    }
  }, 1500);

  // Atalhos de teclado
  document.addEventListener("keydown", (e) => {
    const modalOpen = !$("#winnerModal").classList.contains("hidden");
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (!spinning && !modalOpen) spin();
      return;
    }
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && modalOpen) {
      e.preventDefault();
      closeWinner();
    }
  });

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
  $("#advancedList").addEventListener("click", (ev) => {
    if (!ev.target.classList.contains("del")) return;
    const id = ev.target.dataset.id;
    state.entries = state.entries.filter((e) => e.id !== id);
    saveAdvanced();
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
  $("#btnShuffle").addEventListener("click", () => {
    state.entries.sort(() => Math.random() - 0.5);
    saveToStorage();
    render();
    pushRefresh();
  });

  $("#btnExport").addEventListener("click", () => {
    const now = new Date();
    const stamp = now.getFullYear()
      + String(now.getMonth() + 1).padStart(2, "0")
      + String(now.getDate()).padStart(2, "0")
      + "-" + String(now.getHours()).padStart(2, "0")
      + String(now.getMinutes()).padStart(2, "0")
      + String(now.getSeconds()).padStart(2, "0");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(state, null, 2)], { type: "application/json" })
    );
    a.download = `sorteador-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("#fileImport").addEventListener("change", async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      if (typeof json !== "object" || json === null) { alert("JSON invalido."); return; }
      Object.assign(state, normalizeState(json));
      saveToStorage();
      render();
      pushRefresh();
    } catch (_) { alert("Nao foi possivel ler o arquivo JSON."); }
    ev.target.value = "";
  });

  $("#btnReset").addEventListener("click", () => {
    if (!confirm("Reiniciar todos os sorteados e limpar o historico?")) return;
    state.entries.forEach(e => { e.drawn = false; });
    state.history = [];
    saveToStorage();
    render();
    pushRefresh();
  });

  $("#btnClearHistory").addEventListener("click", () => {
    state.history = [];
    saveToStorage();
    render();
    pushRefresh();
  });

  // modal
  $("#btnCloseModal").addEventListener("click", closeWinner);
  $("#btnRemoveWinner").addEventListener("click", () => {
    const id = $("#winnerModal").dataset.winnerId;
    state.entries = state.entries.filter((e) => e.id !== id);
    saveAdvanced();
    closeWinner();
  });

  window.addEventListener("resize", () => { wheel._resizeForDPR(); wheel.draw(); });

  // ---------- Inicializacao do modo projecao ----------
  if (isProjection) {
    document.body.classList.add("projection-mode");
    // A dica de tela cheia aparece por apenas 2,5s apos abrir a projecao.
    const hint = $("#fsHint");
    hint.classList.remove("hidden");
    setTimeout(() => hint.classList.add("hidden"), 2500);
    document.body.addEventListener("click", tryFullscreen);
  }

  loadState();
})();
