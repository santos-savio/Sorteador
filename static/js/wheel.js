/* Roda de sorteio desenhada em canvas, com animacao de giro ate um indice alvo. */
class Wheel {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.entries = [];      // [{text, color, weight, enabled, drawn}]
    this.rotation = 0;      // radianos
    this.spinning = false;
    this.onTick = null;     // callback ao cruzar uma fatia (para som)
    this._lastTickSlice = -1;
    this._resizeForDPR();
    this.draw();
  }

  _resizeForDPR() {
    const dpr = window.devicePixelRatio || 1;
    const size = this.canvas.clientWidth || 560;
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.size = size;
  }

  setEntries(entries) {
    this.entries = entries.filter((e) => e.enabled);
    this.draw();
  }

  /* As fatias visiveis sao apenas as habilitadas; pesos definem o tamanho. */
  _slices() {
    const total = this.entries.reduce((s, e) => s + Math.max(1, e.weight || 1), 0) || 1;
    let start = 0;
    return this.entries.map((e) => {
      const frac = Math.max(1, e.weight || 1) / total;
      const slice = { entry: e, start, end: start + frac * Math.PI * 2 };
      start = slice.end;
      return slice;
    });
  }

  draw() {
    const { ctx, size } = this;
    const cx = size / 2, cy = size / 2, r = size / 2 - 4;
    ctx.clearRect(0, 0, size, size);

    const slices = this._slices();
    if (slices.length === 0) {
      ctx.fillStyle = "#262d50";
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#9aa3c7";
      ctx.font = "20px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Lista vazia", cx, cy);
      return;
    }

    slices.forEach((s) => {
      const a0 = s.start + this.rotation;
      const a1 = s.end + this.rotation;
      // fatia
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a0, a1);
      ctx.closePath();
      ctx.fillStyle = s.entry.drawn ? this._dim(s.entry.color) : s.entry.color;
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // texto
      const mid = (a0 + a1) / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(mid);
      ctx.textAlign = "right";
      ctx.fillStyle = this._textColor(s.entry.color);
      ctx.font = `600 ${this._fontSize(slices.length)}px Segoe UI, sans-serif`;
      const label = this._truncate(s.entry.text, slices.length);
      ctx.fillText(label, r - 16, 6);
      ctx.restore();
    });

    // miolo
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = "#0c0f22";
    ctx.fill();
  }

  _fontSize(n) {
    if (n > 30) return 11;
    if (n > 18) return 13;
    if (n > 10) return 16;
    return 18;
  }
  _truncate(text, n) {
    const max = n > 20 ? 14 : n > 10 ? 20 : 26;
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
  }
  _textColor(hex) {
    const { r, g, b } = this._rgb(hex);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6 ? "#1a1f3a" : "#ffffff";
  }
  _dim(hex) {
    const { r, g, b } = this._rgb(hex);
    return `rgb(${(r * 0.4) | 0}, ${(g * 0.4) | 0}, ${(b * 0.4) | 0})`;
  }
  _rgb(hex) {
    const h = hex.replace("#", "");
    const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    return {
      r: parseInt(v.slice(0, 2), 16),
      g: parseInt(v.slice(2, 4), 16),
      b: parseInt(v.slice(4, 6), 16),
    };
  }

  /*
   * Gira ate que a fatia do indice alvo (relativo ao array this.entries de
   * entradas habilitadas) pare sob o ponteiro do topo. Retorna uma Promise.
   */
  spinTo(targetIndex, durationMs) {
    if (this.spinning) return Promise.resolve();
    const slices = this._slices();
    if (slices.length === 0) return Promise.resolve();

    const idx = Math.max(0, Math.min(targetIndex, slices.length - 1));
    const target = slices[idx];
    const mid = (target.start + target.end) / 2;

    // O ponteiro fica no topo: angulo -PI/2. Queremos mid + rotation = -PI/2 (mod 2PI).
    const pointer = -Math.PI / 2;
    const turns = 6; // voltas completas para efeito
    const current = this.rotation % (Math.PI * 2);
    let delta = pointer - mid - current;
    delta = ((delta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const finalDelta = delta + turns * Math.PI * 2;

    const startRotation = this.rotation;
    const startTime = performance.now();
    this.spinning = true;
    this._lastTickSlice = -1;

    return new Promise((resolve) => {
      const frame = (now) => {
        const t = Math.min(1, (now - startTime) / durationMs);
        const eased = this._easeOutCubic(t);
        this.rotation = startRotation + finalDelta * eased;
        this.draw();
        this._maybeTick();
        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          this.spinning = false;
          resolve(target.entry);
        }
      };
      requestAnimationFrame(frame);
    });
  }

  _easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  /* Dispara onTick quando a fatia sob o ponteiro muda (efeito de "click"). */
  _maybeTick() {
    if (!this.onTick) return;
    const slices = this._slices();
    if (!slices.length) return;
    const pointer = -Math.PI / 2;
    let ang = (pointer - this.rotation) % (Math.PI * 2);
    ang = (ang + Math.PI * 2) % (Math.PI * 2);
    const current = slices.findIndex((s) => ang >= s.start && ang < s.end);
    if (current !== -1 && current !== this._lastTickSlice) {
      this._lastTickSlice = current;
      this.onTick();
    }
  }
}

window.Wheel = Wheel;
