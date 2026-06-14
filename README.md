# Sorteador

Um clone do [wheelofnames.com](https://wheelofnames.com/): uma roda de sorteio
com backend em **Python (Flask)** e roda animada em **canvas**.

## Funcionalidades

- **Sorteio por lista**: digite um nome por linha.
- **Customização de cada linha**: cor, peso (chance maior/menor) e ativar/desativar — no
  *Editor avançado*.
- **Tempo do giro** configurável (1s a 20s).
- **Embaralhar** a lista a qualquer momento, ou antes de cada giro.
- **Salva os sorteados** no histórico (com data/hora).
- **Modos de sorteio**:
  - *Permitir repetidos*: o mesmo nome pode sair várias vezes.
  - *Somente exclusivos*: o vencedor é marcado como sorteado e não sai de novo.
- **Exportar / Importar JSON** com os nomes, a configuração e a flag de sorteado de cada entrada.
- O vencedor é escolhido **no backend** (respeitando pesos e modo); o frontend apenas
  anima a roda até a fatia correta.

## Como rodar

```bash
pip install -r requirements.txt
python app.py
```

Acesse <http://127.0.0.1:5000>.

## Estrutura

```
app.py                  # backend Flask: estado, sorteio, export/import
requirements.txt
templates/index.html    # interface
static/css/style.css
static/js/wheel.js       # roda em canvas + animação do giro
static/js/app.js         # lógica da UI e chamadas à API
data/state.json          # estado persistido (criado em runtime)
```

## API

| Método | Rota            | Descrição                                            |
|--------|-----------------|-----------------------------------------------------|
| GET    | `/api/state`    | Estado completo (entradas, config, histórico).      |
| POST   | `/api/entries`  | Substitui a lista (strings ou objetos por linha).   |
| POST   | `/api/config`   | Atualiza config (tempo, modo, embaralhar, som, título). |
| POST   | `/api/shuffle`  | Embaralha a lista.                                  |
| POST   | `/api/spin`     | Sorteia (escolhe vencedor, marca e registra).        |
| POST   | `/api/reset`    | Limpa flags de sorteado e o histórico.              |
| GET    | `/api/export`   | Baixa o estado como JSON.                            |
| POST   | `/api/import`   | Carrega estado a partir de um JSON.                 |

## Formato do JSON exportado

```json
{
  "entries": [
    { "id": "…", "text": "Ana", "color": "#e74c3c", "weight": 1, "enabled": true, "drawn": false }
  ],
  "config": {
    "spinDurationMs": 6000, "mode": "repeat",
    "shuffleOnSpin": false, "sound": true, "title": "Sorteador"
  },
  "history": [
    { "id": "…", "entryId": "…", "text": "Ana", "at": "2026-06-13T12:00:00+00:00" }
  ]
}
```
