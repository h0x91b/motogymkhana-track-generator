// Runs generateCourse in a Worker built from the inlined worker source, and
// falls back to the main thread when Workers are unavailable or fail.
import { generateCourse } from '../generator/index.js';

export function createGenerator(onResult) {
  let worker = null;
  let pending = null;

  const runLocally = (job) => {
    setTimeout(() => onResult({ id: job.id, result: generateCourse(job.recipe, job.seed) }), 0);
  };

  try {
    const source = document.getElementById('worker-src')?.textContent ?? '';
    if (source.trim() && typeof Worker === 'function') {
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      worker = new Worker(url);
      worker.onmessage = (event) => {
        if (pending && event.data.id === pending.id) pending = null;
        onResult(event.data);
      };
      worker.onerror = (event) => {
        event.preventDefault?.();
        worker.terminate();
        worker = null;
        if (pending) runLocally(pending);
      };
    }
  } catch {
    worker = null;
  }

  return {
    get mode() {
      return worker ? 'worker' : 'main';
    },
    run(job) {
      pending = job;
      if (worker) worker.postMessage(job);
      else runLocally(job);
    },
  };
}
