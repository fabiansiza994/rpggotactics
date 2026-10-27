/** Serial local presentation preparation. Never delays a network acknowledgement or engine command. */
export class PresentationAssetGate {
  private generation = 0;
  private count = 0;
  private tail = Promise.resolve();
  get busy() { return this.count > 0; }
  constructor(private readonly changed: () => void) {}
  enqueue(load: () => Promise<unknown>, present: () => void): void {
    const generation = this.generation;
    this.count++;
    this.changed();
    this.tail = this.tail.then(async () => {
      if (generation !== this.generation) return;
      try { await load(); } catch { /* Loaders warn and retain existing visual fallbacks. */ }
      if (generation !== this.generation) return;
      try { present(); } finally { this.count--; this.changed(); }
    }).catch(error=>{console.error('Presentation preparation failed',error);});
  }
  clear(): void {
    this.generation++;
    this.count = 0;
    this.tail = Promise.resolve();
    this.changed();
  }
}
