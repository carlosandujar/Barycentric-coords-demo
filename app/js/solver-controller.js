/** Keep the worker alive for factorization reuse; terminate it for cancellation. */
export class SolverController {
  constructor() { this.requestId = 0; this.worker = null; this.pending = null; }

  solve(input, onProgress) {
    this.rejectPending('Superseded by a newer calculation.');
    if (!this.worker) {
      this.worker = new Worker(new URL('./compute-worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => {
        if (!this.pending || data.requestId !== this.requestId) return;
        if (data.type === 'progress') { this.pending.onProgress?.(data.message); return; }
        const pending = this.pending;
        clearTimeout(pending.timer); this.pending = null;
        if (data.type === 'result') pending.resolve(data);
        else pending.reject(new Error(data.message));
      };
      this.worker.onerror = event => { event.preventDefault(); this.cancel('The solver Worker could not run. Reload the page or retry.'); };
      this.worker.onmessageerror = () => this.cancel('The solver Worker returned unreadable data.');
    }
    const requestId = ++this.requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.cancel('Calculation exceeded 30 seconds. Try a smaller mesh or retry.'), 30000);
      this.pending = { resolve, reject, onProgress, timer };
      try { this.worker.postMessage({ ...input, requestId }); }
      catch (error) { this.rejectPending(error.message); }
    });
  }

  rejectPending(message) {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.reject(new Error(message)); this.pending = null;
  }

  cancel(message = 'Calculation canceled.') {
    this.requestId++;
    this.worker?.terminate(); this.worker = null;
    this.rejectPending(message);
  }
}
