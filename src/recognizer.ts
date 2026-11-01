// Microphone capture (16 kHz mono via AudioWorklet) feeding the Tilawa worker.
import type { CorrectionAction } from "@tilawa/core";
import type { Passage, ReciteMode, WorkerIn, WorkerOut } from "./worker";

export type RecognizerEvent =
  | WorkerOut
  | { type: "listening"; active: boolean }
  | { type: "level"; rms: number };

export class Recognizer {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  active = false;

  constructor(private onEvent: (e: RecognizerEvent) => void) {}

  private send(msg: WorkerIn, transfer: Transferable[] = []): void {
    this.worker?.postMessage(msg, transfer);
  }

  /** Spin up the worker and load the model (once). */
  load(): Promise<void> {
    this.ready ??= new Promise<void>((resolve, reject) => {
      const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      this.worker = worker;
      worker.onmessage = (e: MessageEvent<WorkerOut>) => {
        const msg = e.data;
        if (msg.type === "ready") resolve();
        if (msg.type === "error") reject(new Error(msg.message));
        this.onEvent(msg);
      };
      worker.onerror = (e) => reject(new Error(e.message));
      this.send({ type: "init" });
    }).catch((err) => {
      this.ready = null;
      this.worker?.terminate();
      this.worker = null;
      throw err;
    });
    return this.ready;
  }

  /** Start listening. `passage` is what's on screen; correction modes lock onto it. */
  async start(mode: ReciteMode, passage: Passage | null): Promise<void> {
    if (this.active) return;
    await this.load();
    this.send({ type: "set_mode", mode });
    this.send({ type: "set_expected", passage });
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    // Ask for a 16 kHz graph so the browser resamples; the worklet handles the fallback.
    try {
      this.ctx = new AudioContext({ sampleRate: 16000 });
    } catch {
      this.ctx = new AudioContext();
    }
    await this.ctx.audioWorklet.addModule("/audio-processor.js");
    const source = this.ctx.createMediaStreamSource(this.stream);
    const node = new AudioWorkletNode(this.ctx, "audio-stream-processor");
    node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      const samples = new Float32Array(e.data);
      let sum = 0;
      for (const s of samples) sum += s * s;
      this.onEvent({ type: "level", rms: Math.sqrt(sum / samples.length) });
      this.send({ type: "audio", samples }, [samples.buffer]);
    };
    source.connect(node);
    this.active = true;
    this.onEvent({ type: "listening", active: true });
  }

  /** Answer a live-correction flag (retry, dismiss, review later, ...). */
  act(action: CorrectionAction): void {
    this.send({ type: "correction_action", action });
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close();
    this.stream = null;
    this.ctx = null;
    this.send({ type: "stop" });
    this.onEvent({ type: "listening", active: false });
  }
}
