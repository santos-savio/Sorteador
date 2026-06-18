"""
Sorteador - um clone do wheelofnames.com com backend em Python (Flask).

Funcionalidades:
- Sorteio por lista, com customizacao de cada linha (texto, cor, peso, ativo).
- Configuracao do tempo do giro e do modo de sorteio.
- Embaralhamento da lista.
- Salva o historico de sorteados.
- Modo "exclusivos" (remove o vencedor) ou "com repeticao".
- Exporta/importa JSON com nomes, config e flag de sorteado.

Estado gerenciado no frontend via localStorage.
As rotas de API abaixo estao comentadas e reservadas para futura
implementacao de login de usuarios e salvamento de templates no servidor.
"""

from __future__ import annotations

import json          # futuro: serializacao de templates e sessoes
import os            # futuro: leitura/escrita de arquivos de template
import random        # futuro: sorteio verificavel no servidor
import uuid          # futuro: identificadores de usuario e template
from datetime import datetime, timezone  # futuro: timestamps de templates

from flask import Flask, jsonify, request, render_template, Response
from werkzeug.middleware.proxy_fix import ProxyFix

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_prefix=1)

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
# STATE_FILE = os.path.join(DATA_DIR, "state.json")  # futuro: arquivo de estado por usuario

# Paleta padrao usada para colorir entradas novas.
DEFAULT_PALETTE = [
    "#e74c3c", "#e67e22", "#f1c40f", "#2ecc71", "#1abc9c",
    "#3498db", "#9b59b6", "#34495e", "#e84393", "#00cec9",
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def default_config() -> dict:
    return {
        "spinDurationMs": 6000,
        "mode": "repeat",
        "shuffleOnSpin": False,
        "sound": True,
        "title": "Sorteador",
    }


def default_state() -> dict:
    names = ["Ana", "Bruno", "Carla", "Diego", "Eva", "Felipe"]
    entries = [make_entry(n, i) for i, n in enumerate(names)]
    return {
        "entries": entries,
        "config": default_config(),
        "history": [],
    }


def make_entry(text: str, index: int = 0, color: str | None = None) -> dict:
    return {
        "id": uuid.uuid4().hex,
        "text": text,
        "color": color or DEFAULT_PALETTE[index % len(DEFAULT_PALETTE)],
        "weight": 1,
        "enabled": True,
        "drawn": False,
    }


# ---------------------------------------------------------------------------
# Persistencia — comentado; futuro: salvamento de templates por usuario
# ---------------------------------------------------------------------------

# _state: dict = {}
#
# def load_state() -> dict:
#     global _state
#     if os.path.exists(STATE_FILE):
#         try:
#             with open(STATE_FILE, "r", encoding="utf-8") as fh:
#                 _state = json.load(fh)
#         except (json.JSONDecodeError, OSError):
#             _state = default_state()
#     else:
#         _state = default_state()
#     _state = normalize_state(_state)
#     return _state
#
# def save_state() -> None:
#     os.makedirs(DATA_DIR, exist_ok=True)
#     with open(STATE_FILE, "w", encoding="utf-8") as fh:
#         json.dump(_state, fh, ensure_ascii=False, indent=2)
#
# def normalize_state(state: dict) -> dict:
#     """Garante que um estado carregado/importado tenha todos os campos."""
#     out = default_state()
#     out["config"].update(state.get("config") or {})
#     out["history"] = state.get("history") or []
#     entries = []
#     for i, e in enumerate(state.get("entries") or []):
#         text = str(e.get("text", "")).strip()
#         if not text:
#             continue
#         entries.append({
#             "id": str(e.get("id") or uuid.uuid4().hex),
#             "text": text,
#             "color": e.get("color") or DEFAULT_PALETTE[i % len(DEFAULT_PALETTE)],
#             "weight": max(1, int(e.get("weight", 1) or 1)),
#             "enabled": bool(e.get("enabled", True)),
#             "drawn": bool(e.get("drawn", False)),
#         })
#     if entries:
#         out["entries"] = entries
#     return out


# ---------------------------------------------------------------------------
# Logica de sorteio — comentado; futuro: sorteio verificavel no servidor
# ---------------------------------------------------------------------------

# def eligible_indices() -> list[int]:
#     """Indices candidatos ao sorteio segundo o modo configurado."""
#     mode = _state["config"].get("mode", "repeat")
#     idxs = []
#     for i, e in enumerate(_state["entries"]):
#         if not e.get("enabled", True):
#             continue
#         if mode == "unique" and e.get("drawn"):
#             continue
#         idxs.append(i)
#     return idxs
#
# def pick_winner() -> int | None:
#     """Escolhe um indice vencedor respeitando pesos e modo."""
#     idxs = eligible_indices()
#     if not idxs:
#         return None
#     weights = [max(1, int(_state["entries"][i].get("weight", 1))) for i in idxs]
#     return random.choices(idxs, weights=weights, k=1)[0]


# ---------------------------------------------------------------------------
# Rotas
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


# ---------------------------------------------------------------------------
# Rotas de API — comentadas; futuro: login, templates e historico no servidor
# ---------------------------------------------------------------------------

# @app.get("/api/state")
# def api_state():
#     return jsonify(_state)
#
# @app.post("/api/entries")
# def api_set_entries():
#     """Substitui a lista de entradas. Aceita lista de strings ou de objetos."""
#     data = request.get_json(force=True, silent=True) or {}
#     raw = data.get("entries", [])
#     existing = {e["text"]: e for e in _state["entries"]}
#     entries = []
#     for i, item in enumerate(raw):
#         if isinstance(item, str):
#             text = item.strip()
#             if not text:
#                 continue
#             prev = existing.get(text)
#             if prev:
#                 entries.append({**prev})
#             else:
#                 entries.append(make_entry(text, i))
#         elif isinstance(item, dict):
#             text = str(item.get("text", "")).strip()
#             if not text:
#                 continue
#             entries.append({
#                 "id": str(item.get("id") or uuid.uuid4().hex),
#                 "text": text,
#                 "color": item.get("color") or DEFAULT_PALETTE[i % len(DEFAULT_PALETTE)],
#                 "weight": max(1, int(item.get("weight", 1) or 1)),
#                 "enabled": bool(item.get("enabled", True)),
#                 "drawn": bool(item.get("drawn", False)),
#             })
#     _state["entries"] = entries
#     save_state()
#     return jsonify(_state)
#
# @app.post("/api/config")
# def api_set_config():
#     data = request.get_json(force=True, silent=True) or {}
#     cfg = _state["config"]
#     if "spinDurationMs" in data:
#         cfg["spinDurationMs"] = max(500, min(60000, int(data["spinDurationMs"])))
#     if "mode" in data and data["mode"] in ("repeat", "unique"):
#         cfg["mode"] = data["mode"]
#     if "shuffleOnSpin" in data:
#         cfg["shuffleOnSpin"] = bool(data["shuffleOnSpin"])
#     if "sound" in data:
#         cfg["sound"] = bool(data["sound"])
#     if "title" in data:
#         cfg["title"] = str(data["title"])[:120]
#     save_state()
#     return jsonify(_state["config"])
#
# @app.post("/api/shuffle")
# def api_shuffle():
#     random.shuffle(_state["entries"])
#     save_state()
#     return jsonify(_state["entries"])
#
# @app.post("/api/spin")
# def api_spin():
#     """Escolhe o vencedor no backend, registra no historico e marca como sorteado."""
#     if _state["config"].get("shuffleOnSpin"):
#         random.shuffle(_state["entries"])
#     winner_idx = pick_winner()
#     if winner_idx is None:
#         return jsonify({
#             "winner": None,
#             "message": "Nenhum candidato disponivel. "
#                        "No modo exclusivo, reinicie os sorteados.",
#         }), 409
#     entry = _state["entries"][winner_idx]
#     visible = [dict(e) for e in _state["entries"]
#                if e.get("enabled", True) and not e.get("drawn")]
#     visible_index = next(
#         (i for i, e in enumerate(visible) if e["id"] == entry["id"]), 0)
#     record = {
#         "id": uuid.uuid4().hex,
#         "entryId": entry["id"],
#         "text": entry["text"],
#         "at": now_iso(),
#     }
#     _state["history"].insert(0, record)
#     if _state["config"].get("mode") == "unique":
#         entry["drawn"] = True
#     save_state()
#     return jsonify({
#         "winnerIndex": winner_idx,
#         "winner": entry,
#         "visibleIndex": visible_index,
#         "spinEntries": visible,
#         "entries": _state["entries"],
#         "history": _state["history"],
#     })
#
# @app.post("/api/reset")
# def api_reset():
#     """Limpa flags de sorteado e (opcionalmente) o historico."""
#     data = request.get_json(force=True, silent=True) or {}
#     for e in _state["entries"]:
#         e["drawn"] = False
#     if data.get("clearHistory", True):
#         _state["history"] = []
#     save_state()
#     return jsonify(_state)
#
# @app.get("/api/export")
# def api_export():
#     """Baixa o estado completo (nomes, config e flags) como JSON."""
#     payload = json.dumps(_state, ensure_ascii=False, indent=2)
#     fname = f"sorteador-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
#     return Response(
#         payload,
#         mimetype="application/json",
#         headers={"Content-Disposition": f"attachment; filename={fname}"},
#     )
#
# @app.post("/api/import")
# def api_import():
#     """Carrega um estado a partir de um JSON exportado."""
#     global _state
#     data = request.get_json(force=True, silent=True)
#     if not isinstance(data, dict):
#         return jsonify({"error": "JSON invalido"}), 400
#     _state = normalize_state(data)
#     save_state()
#     return jsonify(_state)

# load_state()  # futuro: carrega estado do usuario autenticado ao iniciar


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
