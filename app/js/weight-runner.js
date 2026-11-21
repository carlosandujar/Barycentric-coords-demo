import { createWeightWorkerSource } from './weight-program.js';
import { validateWeights } from './weights.js';

/** Bridge an opaque-origin iframe to its disposable, network-blocked blob Worker. */
function sandboxBridge() {
  let worker = null;
  window.addEventListener('message', event => {
    if (event.source !== parent || event.data !== 'connect-weight-runner' || !event.ports[0]) return;
    const port = event.ports[0];
    port.onmessage = ({ data }) => {
      if (data.type === 'cancel') { worker?.terminate(); worker = null; port.postMessage({ type: 'stopped' }); return; }
      if (data.type !== 'run') return;
      worker?.terminate();
      const url = URL.createObjectURL(new Blob([data.workerSource], { type: 'text/javascript' }));
      try {
        worker = new Worker(url);
        worker.onmessage = ({ data: result }) => { worker.terminate(); worker = null; port.postMessage(result); };
        worker.onerror = event => {
          event.preventDefault(); worker?.terminate(); worker = null;
          port.postMessage({ type: 'error', message: 'The isolated weight evaluator failed. Check the function and retry.' });
        };
        worker.postMessage({ source: data.source, rings: data.rings });
      } catch (error) { port.postMessage({ type: 'error', message: error.message }); }
      finally { URL.revokeObjectURL(url); }
    };
    port.start(); port.postMessage({ type: 'ready' });
  }, { once: true });
}

/** User code never shares the viewer origin, solver globals, or network access. */
export class WeightRunner {
  constructor(timeoutMs = 3000) { this.timeoutMs = timeoutMs; this.active = null; }

  evaluate(source, rings) {
    this.cancel('Superseded by a newer weight calculation.');
    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.hidden = true; frame.title = 'Isolated weight evaluator';
      frame.setAttribute('sandbox', 'allow-scripts');
      const policy = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; connect-src 'none'";
      frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="${policy}"><script>(${sandboxBridge.toString()})()<\/script>`;
      const channel = new MessageChannel();
      let settled = false;
      const dispose = () => { channel.port1.close(); frame.remove(); };
      const cleanup = () => {
        channel.port1.postMessage({ type: 'cancel' });
        setTimeout(dispose, 100);
        clearTimeout(timer);
        if (this.active?.frame === frame) this.active = null;
      };
      const finish = (error, rows) => { if (settled) return; settled = true; cleanup(); error ? reject(error) : resolve(rows); };
      const timer = setTimeout(() => finish(new Error(`Weight evaluation exceeded ${this.timeoutMs / 1000} seconds and was stopped. Check for loops, then Apply again.`)), this.timeoutMs);
      this.active = { frame, cancel: message => finish(new Error(message)) };
      channel.port1.onmessage = ({ data }) => {
        if (data.type === 'stopped') { dispose(); return; }
        if (settled) return;
        if (data.type === 'ready') {
          channel.port1.postMessage({ type: 'run', source, rings, workerSource: createWeightWorkerSource() });
        } else if (data.type === 'error') finish(new Error(String(data.message)));
        else if (data.type === 'result') {
          try {
            if (!Array.isArray(data.rows) || data.rows.length !== rings.length) throw new Error('The evaluator returned an invalid row count.');
            data.rows.forEach((row, i) => {
              if (row.id !== rings[i].center.id) throw new Error('The evaluator returned an unexpected vertex ID.');
              validateWeights(rings[i], row.weights);
            });
            finish(null, data.rows);
          } catch (error) { finish(error); }
        }
      };
      channel.port1.start();
      frame.onload = () => frame.contentWindow.postMessage('connect-weight-runner', '*', [channel.port2]);
      document.body.append(frame);
    });
  }

  cancel(message = 'Weight evaluation canceled.') { this.active?.cancel(message); }
}
