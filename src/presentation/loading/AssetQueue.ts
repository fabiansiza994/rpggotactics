/** Shared decode/download budget. A queued task must represent one texture, not a group. */
export class AssetQueue {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(readonly concurrency = 3) {
    if (concurrency < 1) throw new Error('Asset concurrency must be positive');
  }
  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active++;
        Promise.resolve().then(task).then(resolve, reject).finally(() => {
          this.active--;
          this.waiting.shift()?.();
        });
      };
      if (this.active < this.concurrency) start(); else this.waiting.push(start);
    });
  }
}
