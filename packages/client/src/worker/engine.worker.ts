/// <reference lib="webworker" />
import type { Envelope, Request, Response } from "../protocol.js";
import { loadBundledContent } from "./content.js";
import { Session } from "./session.js";

// The engine runs here, off the UI thread. The UI sends Requests and gets
// Responses; the GameState never leaves this worker.

const SCENARIO = "indpak_1999";
let session: Session | undefined;

function handle(req: Request): Response {
  session ??= new Session(loadBundledContent(), SCENARIO);
  switch (req.type) {
    case "new":
      return session.newGame(req.seed);
    case "seat":
      return { type: "seat", data: session.seat(req.nationId) };
    case "check":
      return { type: "check", result: session.check(req.set) };
    case "submit":
      return session.submit(req.set);
    case "reveal":
      return { type: "reveal", events: session.reveal() };
  }
}

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (ev: MessageEvent<Envelope<Request>>) => {
  const { id, body } = ev.data;
  let res: Response;
  try {
    res = handle(body);
  } catch (e) {
    res = { type: "error", message: e instanceof Error ? e.message : String(e) };
  }
  scope.postMessage({ id, body: res } satisfies Envelope<Response>);
};
