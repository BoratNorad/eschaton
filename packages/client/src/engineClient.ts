import type { Envelope, Request, Response } from "./protocol.js";

type Body<T extends Response["type"]> = Extract<Response, { type: T }>;

/** Promise wrapper around the engine worker. */
export class EngineClient {
  private worker = new Worker(new URL("./worker/engine.worker.ts", import.meta.url), { type: "module" });
  private nextId = 1;
  private waiting = new Map<number, (r: Response) => void>();

  constructor() {
    this.worker.onmessage = (ev: MessageEvent<Envelope<Response>>) => {
      const resolve = this.waiting.get(ev.data.id);
      this.waiting.delete(ev.data.id);
      resolve?.(ev.data.body);
    };
  }

  async call<T extends Request["type"]>(req: Extract<Request, { type: T }>): Promise<Body<T>> {
    const id = this.nextId++;
    const res = await new Promise<Response>((resolve) => {
      this.waiting.set(id, resolve);
      this.worker.postMessage({ id, body: req } satisfies Envelope<Request>);
    });
    if (res.type === "error") throw new Error(res.message);
    if (res.type !== req.type) throw new Error(`expected a ${req.type} reply, got ${res.type}`);
    return res as Body<T>;
  }

  dispose(): void {
    this.worker.terminate();
  }
}
