// Live voice-activity waveform: a strip of rounded bars that scrolls right to
// left, each bar the loudness of a short slice of mic audio. Drawn on a canvas
// from an AnalyserNode every animation frame, so it stays smooth even though
// the recogniser only receives audio in 300 ms chunks.

const BAR = 3; // CSS px
const GAP = 3;
const STEP_MS = 70; // a new bar this often
const NOISE_FLOOR = 0.004;

export class Waveform {
  private analyser: AnalyserNode | null = null;
  private samples: Float32Array<ArrayBuffer> = new Float32Array(1024);
  private bars: number[] = [];
  private raf = 0;
  private lastStep = 0;
  private level = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    /** Smoothed 0..1 loudness, every frame (drives the mic button's glow). */
    private onLevel: (level: number) => void = () => {},
  ) {}

  start(analyser: AnalyserNode): void {
    this.stop();
    this.analyser = analyser;
    this.samples = new Float32Array(analyser.fftSize);
    this.resize();
    this.bars = new Array(this.capacity()).fill(0);
    this.lastStep = performance.now();
    const loop = (now: number) => {
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.analyser = null;
    this.level = 0;
    this.onLevel(0);
    this.canvas.getContext("2d")?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private capacity(): number {
    return Math.ceil(this.canvas.clientWidth / (BAR + GAP)) + 1;
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.canvas.clientWidth * dpr);
    this.canvas.height = Math.round(this.canvas.clientHeight * dpr);
  }

  /** Loudness of the latest audio, 0..1, perceptually spread out. */
  private read(): number {
    this.analyser!.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (const s of this.samples) sum += s * s;
    const rms = Math.sqrt(sum / this.samples.length);
    return Math.min(1, Math.max(0, (rms - NOISE_FLOOR) * 14) ** 0.6);
  }

  private frame(now: number): void {
    if (!this.analyser) return;
    if (this.canvas.width !== Math.round(this.canvas.clientWidth * (window.devicePixelRatio || 1))) this.resize();

    // Fast attack, slow release: speech onsets show at once, then ease off.
    const v = this.read();
    this.level = v > this.level ? v : this.level * 0.88 + v * 0.12;
    this.onLevel(this.level);

    while (now - this.lastStep >= STEP_MS) {
      this.lastStep += STEP_MS;
      this.bars.push(this.level);
      const cap = this.capacity();
      if (this.bars.length > cap) this.bars.splice(0, this.bars.length - cap);
    }
    this.draw((now - this.lastStep) / STEP_MS);
  }

  /** `shift` (0..1) slides the strip between steps so it scrolls smoothly. */
  private draw(shift: number): void {
    const ctx = this.canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.width / dpr;
    const hgt = this.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    ctx.fillStyle = getComputedStyle(this.canvas).color;

    const n = this.bars.length;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const offset = reduce ? 0 : shift * (BAR + GAP);
    for (let i = 0; i < n; i++) {
      // Newest bar at the right edge; the live level feeds it so it moves at once.
      const val = i === n - 1 ? Math.max(this.bars[i], this.level) : this.bars[i];
      const x = w - (n - i) * (BAR + GAP) - offset + GAP;
      if (x + BAR < 0) continue;
      const bh = Math.max(BAR, val * (hgt - 6));
      // Older bars fade toward the left edge.
      ctx.globalAlpha = 0.25 + 0.75 * Math.min(1, (x + BAR) / (w * 0.6));
      ctx.beginPath();
      ctx.roundRect(x, (hgt - bh) / 2, BAR, bh, BAR / 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
