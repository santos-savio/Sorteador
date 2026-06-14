/* Logica da UI: carrega estado do backend, renderiza e dispara sorteios. */
(() => {
  const $ = (sel) => document.querySelector(sel);

  const state = { entries: [], config: {}, history: [] };
  const wheel = new Wheel($("#wheel"));

  // ---------- Modo projeção / controle ----------
  // A janela com ?mode=projection mostra so a roda em tela cheia (sem config).
  // A janela principal que a abriu vira "controle" e comanda via BroadcastChannel.
  const params = new URLSearchParams(location.search);
  const isProjection = params.get("mode") === "projection";

  // Token único por roleta: isola a comunicação entre cada controle e a SUA
  // projeção. Assim, várias roletas abertas (abas/janelas) não interferem
  // umas nas outras. A projeção herda o token do controle via URL; o controle
  // mantém o token na sessionStorage para sobreviver a um reload.
  function newToken() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  const wheelToken = isProjection
    ? (params.get("token") || "default")
    : (sessionStorage.getItem("wheelToken") || (() => {
        const t = newToken();
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

  let projectionWin = null;   // referencia da janela de projeção (na janela de controle)
  let spinFallback = null;    // timeout de seguranca ao delegar o giro
  let pendingHistory = null;  // histórico retido até a roleta parar (modo controlador)

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
  // syncWheel=false mantém a roda como está (usado após o giro, para só remover
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
  async function loadState() {
    Object.assign(state, await api.get("/api/state"));
    render();
    if (isProjection) { wheel._resizeForDPR(); wheel.draw(); }
  }

  function pushRefresh() {
    if (controllerActive()) send({ type: "refresh" });
  }

  async function applyText() {
    const lines = $("#entriesText").value.split("\n").map((l) => l.trim()).filter(Boolean);
    const { data } = await api.post("/api/entries", { entries: lines });
    Object.assign(state, data);
    render();
    pushRefresh();
  }

  async function saveAdvanced() {
    const { data } = await api.post("/api/entries", { entries: state.entries });
    Object.assign(state, data);
    render();
    pushRefresh();
  }

  async function saveConfig(patch) {
    const { data } = await api.post("/api/config", patch);
    state.config = data;
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
      const { ok, data } = await api.post("/api/spin", {});
      if (!ok) {
        alert(data.message || "Nao foi possivel sortear.");
        return;
      }
      if (controllerActive()) {
        // Delega a animação para a janela de projeção.
        delegated = true;
        send({
          type: "spin",
          winner: data.winner,
          visibleIndex: data.visibleIndex,
          spinEntries: data.spinEntries,
          entries: data.entries,
          history: data.history,
          durationMs: state.config.spinDurationMs,
        });
        clearTimeout(spinFallback);
        spinFallback = setTimeout(() => {
          // Fallback: se a projeção não responder, aplica o histórico pendente.
          if (pendingHistory) { state.history = pendingHistory; pendingHistory = null; renderHistory(); }
          spinning = false;
          setSpinDisabled(false);
        }, state.config.spinDurationMs + 5000);
        // Atualiza a lista de entradas agora (o vencedor já saiu da roda),
        // mas retém o histórico até a roleta parar na projeção.
        state.entries = data.entries;
        pendingHistory = data.history;
        render();
      } else {
        // Anima localmente (janela normal ou a própria projeção).
        wheel.setEntries(data.spinEntries);
        await wheel.spinTo(data.visibleIndex, state.config.spinDurationMs);
        state.entries = data.entries;
        state.history = data.history;
        showWinner(data.winner);
        render(false); // mantém o vencedor na roda até fechar o modal
        // Se o giro partiu da projeção, avisa o controle para sincronizar.
        if (isProjection) send({ type: "refresh" });
      }
    } finally {
      if (!delegated) {
        spinning = false;
        setSpinDisabled(false);
      }
    }
  }

  // Executa o giro na janela de projeção a partir do comando do controle.
  async function doProjectionSpin(m) {
    if (spinning) return;
    spinning = true;
    wheel.setEntries(m.spinEntries);
    await wheel.spinTo(m.visibleIndex, m.durationMs);
    state.entries = m.entries;
    state.history = m.history;
    showWinner(m.winner);
    render(false); // mantém o vencedor na roda até fechar o modal
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
    wheel.setEntries(state.entries); // só agora o sorteado sai da roda
    if (controllerActive()) send({ type: "close-modal" });
  }

  // ---------- Tela cheia (projeção) ----------
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
      // Ignora mensagens de outra roleta (proteção extra além do canal isolado).
      if (m.token && m.token !== wheelToken) return;
      if (isProjection) {
        if (m.type === "spin") doProjectionSpin(m);
        else if (m.type === "close-modal") {
          $("#winnerModal").classList.add("hidden");
          wheel.setEntries(state.entries); // remove o sorteado da roda na projeção
        }
        else if (m.type === "refresh") loadState();
      } else if (m.type === "winner-shown") {
        clearTimeout(spinFallback);
        if (pendingHistory) { state.history = pendingHistory; pendingHistory = null; renderHistory(); }
        spinning = false;
        setSpinDisabled(false);
      } else if (m.type === "refresh") {
        // A projeção sorteou por conta própria: sincroniza lista/histórico.
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

  // Opção 1: tela cheia única (mesma janela, sem config)
  function enterSingleFs() {
    closeFsMenu();
    document.body.classList.add("single-fs-mode");
    $("#btnExitSingle").classList.remove("hidden");
    document.documentElement.requestFullscreen?.().catch(() => {});
    // Recalcula canvas após transição de layout
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

  // Opção 2: tela cheia + controles (projeção em nova janela)
  function openProjection() {
    closeFsMenu();
    if (controllerActive()) { projectionWin.focus(); return; }
    const url = location.pathname + "?mode=projection&token=" + encodeURIComponent(wheelToken);
    projectionWin = window.open(url, "sorteador_projecao_" + wheelToken);
    if (!projectionWin) {
      alert("Permita pop-ups para abrir a janela de projeção.");
      return;
    }
    const status = document.querySelector(".ctrl-status");
    if (status) status.textContent = `🖥 Projeção ativa · roleta #${wheelToken.slice(0, 4)}`;
    document.body.classList.add("controller-mode");
    setTimeout(pushRefresh, 800);
  }
  $("#btnFsProjection").addEventListener("click", openProjection);

  // Sai do modo controle se a projeção for fechada manualmente
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
    pushRefresh();
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
      pushRefresh();
    } catch (_) { alert("Nao foi possivel ler o arquivo JSON."); }
    ev.target.value = "";
  });
  $("#btnReset").addEventListener("click", async () => {
    if (!confirm("Reiniciar todos os sorteados e limpar o historico?")) return;
    const { data } = await api.post("/api/reset", { clearHistory: true });
    Object.assign(state, data);
    render();
    pushRefresh();
  });
  $("#btnClearHistory").addEventListener("click", async () => {
    const { data } = await api.post("/api/reset", { clearHistory: true });
    Object.assign(state, data);
    render();
    pushRefresh();
  });

  // modal
  $("#btnCloseModal").addEventListener("click", closeWinner);
  $("#btnRemoveWinner").addEventListener("click", async () => {
    const id = $("#winnerModal").dataset.winnerId;
    state.entries = state.entries.filter((e) => e.id !== id);
    await saveAdvanced();
    closeWinner();
  });

  window.addEventListener("resize", () => { wheel._resizeForDPR(); wheel.draw(); });

  // ---------- Inicialização do modo projeção ----------
  if (isProjection) {
    document.body.classList.add("projection-mode");
    // A dica de tela cheia aparece por apenas 2,5s após abrir a projeção.
    const hint = $("#fsHint");
    hint.classList.remove("hidden");
    setTimeout(() => hint.classList.add("hidden"), 2500);
    document.body.addEventListener("click", tryFullscreen);
  }

  loadState();
})();
