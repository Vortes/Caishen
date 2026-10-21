import type { ChangeSet } from "~/domain/rows";

// How the browser learns that the household changed (ADR 0006): a revision
// seen on any server response, the tab regaining focus or the network,
// another tab's confirmed change, and later a push service. Every source
// emits hints here and the SyncController decides whether to pull.

export type RevisionHint = {
  /** A revision the server has reached; absent when only possibly newer. */
  revision?: number;
  /** The change that reached it, when another tab already has it. */
  changeSet?: ChangeSet;
};

export class RevisionSignal {
  private readonly listeners = new Set<(hint: RevisionHint) => void>();

  subscribe(listener: (hint: RevisionHint) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(hint: RevisionHint = {}) {
    for (const listener of this.listeners) listener(hint);
  }
}

/** Hints whenever the page becomes visible, regains focus, or comes online. */
export function watchFocusAndOnline(
  signal: RevisionSignal,
  target: Window = window,
): () => void {
  const hint = () => {
    if (target.document.visibilityState !== "hidden") signal.emit();
  };
  target.addEventListener("focus", hint);
  target.addEventListener("online", hint);
  target.document.addEventListener("visibilitychange", hint);
  return () => {
    target.removeEventListener("focus", hint);
    target.removeEventListener("online", hint);
    target.document.removeEventListener("visibilitychange", hint);
  };
}
