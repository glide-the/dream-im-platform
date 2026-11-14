// [Input] Verified actor identities and content-free lifecycle observations.
// [Output] Optional calls to the server-owned capacity observer, with no business fallback or telemetry dependency.
// [Pos] Passive instrumentation boundary; observer failures never retry or change business operations.

type Operation = "account_lock_wait" | "payload_write" | "payload_queue_wait" | "settlement";
type Observer = {
  authenticated(domain: "admin" | "gateway", actorId: string): void;
  operation(name: Operation, seconds: number, outcome: "success" | "error"): void;
  accountLocked(client: object): void;
  transactionEnded(client: object): void;
  queueDelta(events: number, bytes: number): void;
  firstToken(): void;
};
type ObserverGlobal = typeof globalThis & { __inkCapacityObserverV1?: Observer };

function emit(action: (observer: Observer) => void) {
  try {
    const observer = (globalThis as ObserverGlobal).__inkCapacityObserverV1;
    if (observer) action(observer);
  } catch { /* Observation is secondary to the original business operation. */ }
}

export function observeAuthenticatedActor(domain: "admin" | "gateway", actorId: string) {
  emit(observer => observer.authenticated(domain, actorId));
}
export function observeAccountLock(client: object) { emit(observer => observer.accountLocked(client)); }
export function observeTransactionEnd(client: object) { emit(observer => observer.transactionEnded(client)); }
export function observePayloadQueue(events: number, bytes: number) { emit(observer => observer.queueDelta(events, bytes)); }
export function observeFirstToken() { emit(observer => observer.firstToken()); }

export async function observeCapacityOperation<T>(name: Operation, operation: () => Promise<T>): Promise<T> {
  const started = performance.now();
  let outcome: "success" | "error" = "error";
  try {
    const value = await operation();
    outcome = "success";
    return value;
  } finally {
    emit(observer => observer.operation(name, (performance.now() - started) / 1_000, outcome));
  }
}
