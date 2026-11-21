import test from 'node:test';
import assert from 'node:assert/strict';
import { SolverController } from '../app/js/solver-controller.js';

test('worker requests ignore stale replies, reuse the worker, and cancel cleanly', async () => {
  const originalWorker = globalThis.Worker;
  const workers = [];
  class TestWorker {
    constructor() { this.messages = []; this.terminated = false; workers.push(this); }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    reply(data) { this.onmessage({ data }); }
  }
  globalThis.Worker = TestWorker;
  const controller = new SolverController();
  try {
    const first = controller.solve({ method: 'uniform' });
    const firstRejected = assert.rejects(first, /Superseded/);
    const second = controller.solve({ method: 'meanValue' });
    await firstRejected;
    assert.equal(workers.length, 1);
    const worker = workers[0];
    const [oldRequest, newRequest] = worker.messages;
    worker.reply({ type: 'result', requestId: oldRequest.requestId, uvs: ['stale'] });
    assert.notEqual(controller.pending, null);
    worker.reply({ type: 'result', requestId: newRequest.requestId, uvs: ['current'] });
    assert.deepEqual((await second).uvs, ['current']);
    const third = controller.solve({ method: 'cotangent' });
    const canceled = assert.rejects(third, /canceled/);
    controller.cancel();
    await canceled;
    assert.equal(worker.terminated, true);
    assert.equal(controller.pending, null);
    const fourth = controller.solve({ method: 'uniform' });
    assert.equal(workers.length, 2);
    const failed = assert.rejects(fourth, /could not run/);
    workers[1].onerror({ preventDefault() {} });
    await failed;
  } finally {
    controller.cancel();
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  }
});
