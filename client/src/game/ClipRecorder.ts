/**
 * "Clip it": keeps the last few seconds of the game canvas (and its sound) so a funny moment can be
 * saved as a video file. MediaRecorder cannot trim the start of a recording, so two recorders run
 * staggered and restart every SEGMENT ms; a clip is whichever one has been running longer (5-10 s).
 * Client-only and cosmetic; nothing here touches the game.
 */
const SEGMENT = 10_000;

interface Track {
  rec: MediaRecorder;
  startedAt: number;
  chunks: Blob[];
  save: boolean;
}

export class ClipRecorder {
  private tracks: Track[] = [];
  private timers: number[] = [];
  private stream: MediaStream | null = null;
  private mime = '';
  private busy = false;

  static get supported(): boolean {
    return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  }

  constructor(private canvas: HTMLCanvasElement, private audio: MediaStream | null) {}

  start(): void {
    if (!ClipRecorder.supported || this.stream) return;
    const video = this.canvas.captureStream(30);
    this.stream = new MediaStream([...video.getVideoTracks(), ...(this.audio?.getAudioTracks() ?? [])]);
    this.mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    for (let i = 0; i < 2; i++) {
      const t = this.makeTrack();
      if (!t) return this.stop();
      this.tracks.push(t);
      // The second recorder starts half a segment later, so one of them always holds 5-10 s.
      const begin = () => {
        this.restart(t);
        this.timers.push(window.setInterval(() => this.restart(t), SEGMENT));
      };
      if (i === 0) begin();
      else this.timers.push(window.setTimeout(begin, SEGMENT / 2));
    }
  }

  private makeTrack(): Track | null {
    if (!this.stream) return null;
    try {
      const rec = new MediaRecorder(this.stream, { ...(this.mime ? { mimeType: this.mime } : {}), videoBitsPerSecond: 2_500_000 });
      const t: Track = { rec, startedAt: 0, chunks: [], save: false };
      rec.ondataavailable = (e) => e.data.size && t.chunks.push(e.data);
      rec.onstop = () => {
        if (t.save) {
          t.save = false;
          this.deliver(new Blob(t.chunks, { type: this.mime || 'video/webm' }));
        }
        this.begin(t);
      };
      return t;
    } catch {
      return null;
    }
  }

  /** Throw the current recording away and start a fresh one (onstop calls begin). */
  private restart(t: Track): void {
    if (t.save) return; // being saved right now; its onstop starts the next one
    if (t.rec.state === 'recording') t.rec.stop();
    else this.begin(t);
  }

  private begin(t: Track): void {
    t.chunks = [];
    if (!this.stream || t.rec.state !== 'inactive') return;
    t.startedAt = performance.now();
    try {
      t.rec.start();
    } catch {
      /* the stream ended */
    }
  }

  /** Save the last 5-10 seconds. Returns false when nothing is recorded yet. */
  clip(): boolean {
    if (this.busy) return false;
    const live = this.tracks.filter((t) => t.rec.state === 'recording').sort((a, b) => a.startedAt - b.startedAt);
    const t = live[0];
    if (!t || performance.now() - t.startedAt < 1500) return false;
    this.busy = true;
    t.save = true;
    t.rec.stop();
    return true;
  }

  private deliver(blob: Blob): void {
    this.busy = false;
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const name = `orb-lancers-clip-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
    const file = typeof File !== 'undefined' ? new File([blob], name, { type: blob.type }) : null;
    // Phones: open the share sheet (TikTok, WhatsApp...). Desktop: download the file.
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    if (file && nav.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
      void navigator.share({ files: [file], title: 'Orb Lancers clip' }).catch(() => this.download(blob, name));
      return;
    }
    this.download(blob, name);
  }

  private download(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  stop(): void {
    this.timers.forEach((id) => (clearInterval(id), clearTimeout(id)));
    this.timers = [];
    for (const t of this.tracks) {
      t.save = false;
      if (t.rec.state !== 'inactive') t.rec.stop();
    }
    this.tracks = [];
    this.stream?.getVideoTracks().forEach((tr) => tr.stop());
    this.stream = null;
  }
}
