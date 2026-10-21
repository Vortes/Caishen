import type { BudgetStore } from "./budget-store";
import type { RevisionHint, RevisionSignal } from "./revision-signal";

// The signed-in user's tabs tell each other what the server confirmed.
// Each tab keeps its own pending commands and undo history; a tab that hears
// of the next revision applies its change set, and one further behind pulls.

export const tabChannelName = (userId: string) => `caishen:${userId}`;

type TabMessage = Required<Pick<RevisionHint, "revision">> &
  Pick<RevisionHint, "changeSet">;

export function connectTabs(
  store: BudgetStore,
  signal: RevisionSignal,
  channel: BroadcastChannel,
): () => void {
  const unsubscribe = store.onCommit((commit) => {
    if (commit.source !== "server") return;
    const message: TabMessage = {
      revision: commit.revision,
      changeSet: commit.changeSet,
    };
    channel.postMessage(message);
  });
  const receive = (event: MessageEvent<unknown>) => {
    const message = event.data as Partial<TabMessage> | null;
    if (typeof message?.revision === "number")
      signal.emit({ revision: message.revision, changeSet: message.changeSet });
  };
  channel.addEventListener("message", receive);
  return () => {
    unsubscribe();
    channel.removeEventListener("message", receive);
    channel.close();
  };
}
