import { createWorkerHandler } from '../_shared/worker.ts';

Deno.serve(createWorkerHandler({
  env: (name) => Deno.env.get(name),
  fetch,
  now: Date.now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  uuid: () => crypto.randomUUID(),
  log: (event, details) => console.log(JSON.stringify({ event, ...details })),
}));
