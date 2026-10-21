"use client";

import {
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  InfoIcon,
  LandmarkIcon,
  LoaderCircleIcon,
  PlusIcon,
} from "lucide-react";
import { Dialog, Popover } from "radix-ui";
import { createPortal } from "react-dom";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import {
  accountSetupType,
  bankAccountMappings,
  useBankAccountSetupForm,
} from "~/components/banks/bank-account-setup";
import { loadPlaid } from "~/components/banks/plaid-link-sdk";
import { usePlaidLink } from "~/components/banks/use-plaid-link";
import type { State } from "~/components/budget/types";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { usePortalContainer } from "~/components/ui/tooltip";
import { syncedLabel } from "./model";
import styles from "./banks.module.css";

type Connection = State["connections"][number];
type BankAccount = Connection["accounts"][number];
type Notify = (message: string, tone?: "neutral" | "attention") => void;

const bankName = (connection: Connection | undefined) =>
  connection?.institutionName ?? "your bank";

// Accounts the setup form could add to Cash or Credit right now.
function addableAccounts(connection: Connection) {
  const mappings = bankAccountMappings(connection.accountMappings);
  return connection.accounts.filter(
    (account) =>
      !mappings.has(account.accountId) && accountSetupType(account).kind,
  );
}

// Plaid reports balances in dollars, and a card's balance as the amount owed.
// The sidebar shows card debt as negative, so the popover does too.
function bankBalance(account: BankAccount) {
  if (account.currentBalance === null) return null;
  const value =
    account.type === "credit"
      ? -account.currentBalance
      : account.currentBalance;
  if (!account.currency || !/^[A-Z]{3}$/.test(account.currency))
    return value.toLocaleString("en-US", { minimumFractionDigits: 2 });
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: account.currency,
  }).format(value);
}

// Connecting a bank outlives the sidebar, which settings swap out, so the
// Plaid flow and its dialog live with the workspace. The flow is Plaid's
// own centered window, then one dialog of ours in the same place: saving,
// updating, and adding the bank's accounts to the budget.
export function useBankConnections({
  state,
  notify,
  holdOpen,
}: {
  state: State;
  notify: Notify;
  holdOpen: () => () => void;
}) {
  const link = usePlaidLink();
  const [setupId, setSetupId] = useState<string | null>(null);
  // The user closed the dialog for the flow that's running; reopen it for the
  // next one.
  const [dismissed, setDismissed] = useState(false);
  const available =
    state.services.find((service) => service.name === "Plaid")?.status ===
    "configured";

  // Whether the running flow signs an existing connection back in.
  const reconnect = useRef(false);
  // Reacts once to each step the flow lands on.
  const phase = useRef(link.phase);
  const latest = useRef({ state, notify, link });
  latest.current = { state, notify, link };
  useEffect(() => {
    const previous = phase.current;
    phase.current = link.phase;
    if (previous === link.phase) return;
    const { state, notify, link: flow } = latest.current;
    if (link.phase === "idle" && flow.error && !flow.canonicalOrigin)
      notify(flow.error, "attention");
    if (link.phase !== "complete" || flow.needsSync) return;
    const connection = state.connections.find(
      (item) => item.id === flow.connectionId,
    );
    if (connection?.error) notify(connection.error, "attention");
    else if (connection && addableAccounts(connection).length) {
      setDismissed(false);
      setSetupId(connection.id);
    } else
      notify(
        `${reconnect.current ? "Reconnected" : "Connected"} ${bankName(connection)}`,
      );
  }, [link.phase]);

  const setup = state.connections.find((item) => item.id === setupId);
  const view: DialogView | null = setup
    ? { type: "setup", connection: setup }
    : dismissed
      ? null
      : link.phase === "saving" || link.phase === "syncing"
        ? { type: "progress", phase: link.phase }
        : link.phase === "complete" && link.needsSync
          ? { type: "sync-failed", error: link.error }
          : link.canonicalOrigin
            ? { type: "elsewhere", origin: link.canonicalOrigin }
            : null;

  // Undo and redo wait while the dialog is up.
  const showing = view !== null;
  useEffect(() => (showing ? holdOpen() : undefined), [showing, holdOpen]);

  return {
    connections: state.connections,
    available,
    // Getting Plaid ready: the link token and its script, before its window.
    opening: link.phase === "loading",
    // Plaid's own window is up.
    plaidOpen: link.phase === "link",
    busy: link.busy,
    // The connection being reconnected, while that runs.
    reconnecting: link.busy ? link.connectionId : undefined,
    view,
    state,
    notify,
    start: (connectionId?: string) => {
      reconnect.current = Boolean(connectionId);
      setDismissed(false);
      void link.start(connectionId);
    },
    setUp: (connectionId: string) => setSetupId(connectionId),
    retrySync: () => void link.retrySync(),
    close: () => {
      setSetupId(null);
      setDismissed(true);
    },
  };
}

type DialogView =
  | { type: "progress"; phase: "saving" | "syncing" }
  | { type: "sync-failed"; error: string }
  | { type: "elsewhere"; origin: string }
  | { type: "setup"; connection: Connection };

export type BankConnections = ReturnType<typeof useBankConnections>;

const BankConnectionsContext = createContext<BankConnections | null>(null);

export const BankConnectionsProvider = BankConnectionsContext.Provider;

function useBanks() {
  const value = useContext(BankConnectionsContext);
  if (!value) throw new Error("useBanks needs a BankConnectionsProvider.");
  return value;
}

// The sidebar footer's one bank control: the banks in a popover, with
// connecting another as the menu's last row. Checking on banks is the everyday
// job; connecting one is rare, so it sits one click deeper.
export function BanksPopover() {
  const banks = useBanks();
  const container = usePortalContainer();
  const id = useId();
  const [open, setOpen] = useState(false);
  // Opened from the keyboard it appears at once and focuses its first
  // control; a click animates and leaves focus on the popover itself.
  const [byKeyboard, setByKeyboard] = useState(false);
  const pointer = useRef(false);
  const attention = banks.connections.some((item) => item.error);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setByKeyboard(!pointer.current);
        pointer.current = false;
        setOpen(next);
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className={styles.trigger}
          aria-busy={banks.opening || undefined}
          onPointerDown={() => (pointer.current = true)}
        >
          {/* Plaid opens from inside the popover, which closes first, so the
              trigger carries the wait. */}
          {banks.opening ? (
            <LoaderCircleIcon
              size={14}
              className={`${styles.triggerIcon} ${styles.spin}`}
              aria-hidden
            />
          ) : (
            <LandmarkIcon
              size={14}
              className={styles.triggerIcon}
              aria-hidden
            />
          )}
          Banks
          {attention && (
            <span
              className={styles.warningDot}
              role="img"
              aria-label="A bank needs attention"
            />
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content
          className={styles.popover}
          data-instant={byKeyboard || undefined}
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          aria-labelledby={`${id}-title`}
          onOpenAutoFocus={(event) => {
            if (byKeyboard) return;
            event.preventDefault();
            (event.currentTarget as HTMLElement).focus();
          }}
        >
          <h2 id={`${id}-title`} className={styles.popoverTitle}>
            Connected banks
          </h2>
          {banks.connections.length ? (
            <ul className={styles.banks}>
              {banks.connections.map((connection) => (
                <BankItem
                  key={connection.id}
                  connection={connection}
                  onAction={() => setOpen(false)}
                />
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>
              {banks.available
                ? "No banks connected yet. Connect one to bring in balances and activity for review. Plaid handles the sign-in; Caishen never sees your password."
                : "Bank connections aren’t set up on this server yet. Manual accounts and transactions still work."}
            </p>
          )}
          {banks.available && (
            <>
              <div className={styles.separator} role="separator" />
              <button
                type="button"
                className={styles.action}
                disabled={banks.busy}
                // Plaid's script is large; fetch it while the pointer is on
                // the way.
                onPointerEnter={() => void loadPlaid().catch(() => undefined)}
                onClick={() => {
                  setOpen(false);
                  banks.start();
                }}
              >
                <PlusIcon size={14} aria-hidden />
                Connect a bank
              </button>
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function BankItem({
  connection,
  onAction,
}: {
  connection: Connection;
  onAction: () => void;
}) {
  const banks = useBanks();
  const mappings = bankAccountMappings(connection.accountMappings);
  // Only accounts in the budget are listed; the rest are counted, since a
  // bank often holds accounts (a 401k, a mortgage) the budget never will.
  const inBudget = connection.accounts.filter((account) =>
    mappings.has(account.accountId),
  );
  const outside = connection.accounts.length - inBudget.length;
  const addable = addableAccounts(connection).length > 0;
  const reconnecting = banks.reconnecting === connection.id;
  return (
    <li className={styles.bank}>
      <div className={styles.bankHeader}>
        <div className={styles.bankTitle}>
          <strong className={styles.bankName}>{bankName(connection)}</strong>
          <BankStatus connection={connection} />
        </div>
        {connection.error && (
          <Button
            size="sm"
            // The fix for what this popover is showing, so its main action,
            // unless several banks need it and none is the one main action.
            variant={
              banks.connections.filter((item) => item.error).length === 1
                ? "quiet-primary"
                : "quiet"
            }
            disabled={!banks.available || banks.busy}
            // Plaid's script is large; fetch it while the pointer is on the
            // way.
            onPointerEnter={() => void loadPlaid().catch(() => undefined)}
            onClick={() => {
              onAction();
              banks.start(connection.id);
            }}
          >
            {reconnecting ? "Reconnecting…" : "Reconnect"}
          </Button>
        )}
      </div>
      {inBudget.length > 0 && (
        <ul
          className={styles.accounts}
          aria-label={`${bankName(connection)} accounts in your budget`}
        >
          {inBudget.map((account) => (
            <li key={account.accountId} className={styles.account}>
              <span className={styles.accountName}>
                {account.name}
                {account.mask && (
                  <span className={styles.mask}> ••{account.mask}</span>
                )}
              </span>
              <span className={styles.balance}>
                {bankBalance(account) ?? "Unavailable"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {outside > 0 && (
        <div className={styles.outside}>
          <span>
            {inBudget.length
              ? `${outside} more not added`
              : `${outside} ${outside === 1 ? "account" : "accounts"} not added`}
          </span>
          {addable && (
            <Button
              size="sm"
              variant="quiet"
              disabled={banks.busy}
              onClick={() => {
                onAction();
                banks.setUp(connection.id);
              }}
            >
              Add accounts
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

// A toggletip: hover shows the bank's status, and a click or tap pins it,
// since a touch screen can't hover and the reason a bank needs reconnecting
// must be reachable there too. The visible signal (the alert icon and the
// Reconnect button) never depends on opening it.
export function BankStatus({ connection }: { connection: Connection }) {
  const container = usePortalContainer();
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const later = (next: boolean, delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), delay);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const updated = connection.lastSyncedAt
    ? `${connection.error ? "Last updated" : "Updated"} ${syncedLabel(connection.lastSyncedAt, null)}`
    : "Not updated yet";
  const Icon = connection.error ? CircleAlertIcon : InfoIcon;
  // Hover only previews; leaving closes it unless a click pinned it.
  const hover = {
    onPointerEnter: (event: PointerEvent) => {
      if (event.pointerType === "mouse" && !pinned.current) later(true, 250);
    },
    onPointerLeave: (event: PointerEvent) => {
      if (event.pointerType === "mouse" && !pinned.current) later(false, 100);
    },
  };
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        clearTimeout(timer.current);
        pinned.current = false;
        setOpen(false);
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className={styles.status}
          data-attention={connection.error ? true : undefined}
          aria-label={
            connection.error
              ? `Why ${bankName(connection)} needs attention`
              : `When ${bankName(connection)} last updated`
          }
          {...hover}
          onClick={(event) => {
            // Radix would toggle on its own; this keeps hover and pin apart.
            event.preventDefault();
            clearTimeout(timer.current);
            const next = !(open && pinned.current);
            pinned.current = next;
            setOpen(next);
          }}
        >
          <Icon size={13} aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content
          className={styles.tip}
          side="top"
          sideOffset={6}
          collisionPadding={8}
          {...hover}
          // It only describes; focus stays where the user left it.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {connection.error && <p>{connection.error}</p>}
          <p className={styles.tipMeta}>{updated}</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// The one dialog around Plaid's window, centered where Plaid's stood.
export function BankDialog() {
  const banks = useBanks();
  const container = usePortalContainer();
  const view = banks.view;
  // Saving can't be walked away from mid-request; everything else can close.
  const locked = useRef(() => false);
  const closable = view?.type !== "progress" || view.phase !== "saving";
  // Plaid draws no backdrop of its own, so the shell dims behind its window.
  // The dialog that follows it lands on that same scrim instead of fading in
  // a second one.
  const [continued, setContinued] = useState(false);
  if (banks.plaidOpen && !continued) setContinued(true);
  if (!banks.plaidOpen && !view && continued) setContinued(false);
  return (
    <>
      {banks.plaidOpen &&
        container &&
        createPortal(
          <div className={styles.overlay} data-state="open" aria-hidden />,
          container,
        )}
      <Dialog.Root
        open={view !== null}
        onOpenChange={(open) => {
          if (open || !closable || locked.current()) return;
          banks.close();
        }}
      >
        <Dialog.Portal container={container}>
          <Dialog.Overlay
            className={styles.overlay}
            data-continued={continued || undefined}
          />
          <Dialog.Content
            className={styles.dialog}
            data-wide={view?.type === "setup" || undefined}
            aria-describedby={undefined}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              (event.currentTarget as HTMLElement).focus();
            }}
          >
            {view?.type === "progress" && (
              <>
                <div className={styles.header}>
                  <Dialog.Title className={styles.title}>
                    Connecting your bank
                  </Dialog.Title>
                  <p className={styles.description} role="status">
                    {view.phase === "saving"
                      ? "Saving your connection…"
                      : "Bringing in your accounts and recent activity. This can take a minute."}
                  </p>
                </div>
                <div className={styles.progress} aria-hidden />
              </>
            )}
            {view?.type === "sync-failed" && (
              <>
                <div className={styles.header}>
                  <Dialog.Title className={styles.title}>
                    Your bank is connected
                  </Dialog.Title>
                  <p className={styles.description}>
                    Its accounts couldn’t update yet, so there’s nothing to add
                    to your budget. Try again in a moment.
                  </p>
                </div>
                {view.error && <ErrorText>{view.error}</ErrorText>}
                <div className={styles.footer}>
                  <Dialog.Close asChild>
                    <Button>Later</Button>
                  </Dialog.Close>
                  <Button variant="primary" onClick={banks.retrySync}>
                    Try again
                  </Button>
                </div>
              </>
            )}
            {view?.type === "elsewhere" && (
              <>
                <div className={styles.header}>
                  <Dialog.Title className={styles.title}>
                    Connect from {new URL(view.origin).host}
                  </Dialog.Title>
                  <p className={styles.description}>
                    Your bank sends you back to the address where you started,
                    so connect from Caishen’s bank address.
                  </p>
                </div>
                <div className={styles.footer}>
                  <Dialog.Close asChild>
                    <Button>Cancel</Button>
                  </Dialog.Close>
                  <Button variant="primary" asChild>
                    <a href={view.origin}>Open {new URL(view.origin).host}</a>
                  </Button>
                </div>
              </>
            )}
            {view?.type === "setup" && (
              <SetupForm
                key={view.connection.id}
                connection={view.connection}
                locked={locked}
              />
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function ErrorText({ children }: { children: string }) {
  return (
    <p className={styles.error} role="alert">
      <CircleAlertIcon size={13} aria-hidden />
      {children}
    </p>
  );
}

function SetupForm({
  connection,
  locked,
}: {
  connection: Connection;
  locked: { current: () => boolean };
}) {
  const banks = useBanks();
  const id = useId();
  const [showUnsupported, setShowUnsupported] = useState(false);
  const form = useBankAccountSetupForm({
    state: banks.state,
    connection,
    onSaved: (added) => {
      banks.close();
      banks.notify(
        `Added ${added} ${added === 1 ? "account" : "accounts"} from ${bankName(connection)}`,
      );
    },
  });
  locked.current = form.locked;
  const { busy } = form;
  // Accounts Cash and Credit can't hold (retirement, loans) fold into one
  // line at the end, so the ones the user can add lead.
  const unsupported = form.rows.filter(
    (row) => !row.addedAs && row.type.reason,
  );
  const rows = form.rows.filter((row) => !unsupported.includes(row));
  // Name the accounts still preparing only when some others are ready;
  // otherwise the status line under the list says it once for all of them.
  const someReady = rows.some((row) => !row.addedAs && row.synchronized);
  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        const element = event.currentTarget;
        await form.submit();
        // Once the errors render, take the user to the first one.
        requestAnimationFrame(() =>
          element.querySelector<HTMLElement>("[aria-invalid=true]")?.focus(),
        );
      }}
    >
      <div className={styles.header}>
        <Dialog.Title className={styles.title}>
          Add {bankName(connection)} to your budget
        </Dialog.Title>
        <p className={styles.description}>
          Checking and savings go in Cash, credit cards in Credit. Each starts
          at the bank’s current balance.
        </p>
      </div>
      <div className={styles.body}>
        <ul className={styles.setupList}>
          {rows.map(
            ({
              account,
              synchronized,
              draft,
              fieldError,
              addedAs,
              existingAccounts,
            }) => {
              const fieldId = `${id}-${account.accountId}`;
              const selectable = !addedAs && synchronized && Boolean(draft);
              const hint = draft?.existingAccountId
                ? "Keeps its name and balance. Bank activity from this date on comes in for review."
                : null;
              return (
                <li key={account.accountId} className={styles.setupRow}>
                  <label
                    className={styles.setupCheck}
                    data-disabled={!selectable || busy || undefined}
                  >
                    {addedAs ? (
                      <CheckIcon
                        size={14}
                        className={styles.added}
                        aria-hidden
                      />
                    ) : (
                      <Checkbox
                        checked={selectable && (draft?.selected ?? false)}
                        disabled={!selectable || busy}
                        onCheckedChange={(checked) =>
                          form.change(account.accountId, {
                            selected: checked === true,
                          })
                        }
                      />
                    )}
                    <span className={styles.accountName}>
                      {account.name}
                      {account.mask && (
                        <span className={styles.mask}> ••{account.mask}</span>
                      )}
                    </span>
                    <span className={styles.balance}>
                      {synchronized ? bankBalance(account) : null}
                    </span>
                  </label>
                  {addedAs && <p className={styles.note}>Added as {addedAs}</p>}
                  {!addedAs && !synchronized && someReady && (
                    <p className={styles.note}>
                      Your bank is still preparing this account.
                    </p>
                  )}
                  {selectable && draft?.selected && (
                    <div className={styles.fields}>
                      {draft.existingAccountId ? (
                        <div className={styles.field}>
                          <label htmlFor={`${fieldId}-start`}>
                            Import from
                          </label>
                          <input
                            id={`${fieldId}-start`}
                            type="date"
                            value={draft.startDate}
                            disabled={busy}
                            data-invalid={Boolean(fieldError) || undefined}
                            aria-invalid={Boolean(fieldError) || undefined}
                            aria-describedby={`${fieldId}-hint`}
                            onChange={(event) =>
                              form.change(account.accountId, {
                                startDate: event.target.value,
                              })
                            }
                          />
                        </div>
                      ) : (
                        <div className={styles.field}>
                          <label htmlFor={`${fieldId}-name`}>Name</label>
                          <input
                            id={`${fieldId}-name`}
                            value={draft.name}
                            maxLength={120}
                            autoComplete="off"
                            spellCheck={false}
                            disabled={busy}
                            data-invalid={Boolean(fieldError) || undefined}
                            aria-invalid={Boolean(fieldError) || undefined}
                            aria-describedby={
                              fieldError ? `${fieldId}-hint` : undefined
                            }
                            onChange={(event) =>
                              form.change(account.accountId, {
                                name: event.target.value,
                              })
                            }
                          />
                        </div>
                      )}
                      {existingAccounts.length > 0 && (
                        <div className={styles.field}>
                          <label htmlFor={`${fieldId}-as`}>Add as</label>
                          <select
                            id={`${fieldId}-as`}
                            value={draft.existingAccountId}
                            disabled={busy}
                            onChange={(event) =>
                              form.change(account.accountId, {
                                existingAccountId: event.target.value,
                              })
                            }
                          >
                            <option value="">New account</option>
                            {existingAccounts.map((existing) => (
                              <option key={existing.id} value={existing.id}>
                                {existing.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      {(fieldError ?? hint) && (
                        <p
                          id={`${fieldId}-hint`}
                          className={styles.fieldHint}
                          data-invalid={Boolean(fieldError) || undefined}
                        >
                          {fieldError && (
                            <CircleAlertIcon size={13} aria-hidden />
                          )}
                          {fieldError ?? hint}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            },
          )}
        </ul>
        {unsupported.length > 0 && (
          <div className={styles.unsupported}>
            <button
              type="button"
              className={styles.disclosure}
              aria-expanded={showUnsupported}
              onClick={() => setShowUnsupported((value) => !value)}
            >
              <ChevronRightIcon size={12} aria-hidden />
              {unsupported.length}{" "}
              {unsupported.length === 1 ? "account" : "accounts"} can’t be added
              yet
            </button>
            {showUnsupported && (
              <ul className={styles.unsupportedList}>
                {unsupported.map(({ account, type }) => (
                  <li key={account.accountId}>
                    <span className={styles.accountName}>
                      {account.name}
                      {account.mask && (
                        <span className={styles.mask}> ••{account.mask}</span>
                      )}
                    </span>
                    <span>{type.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {form.waiting && (
        <div className={styles.waiting} role="status">
          <p>{form.waiting}</p>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void form.updateBank()}
          >
            {form.updating ? "Updating…" : "Update bank"}
          </Button>
        </div>
      )}
      {form.error && <ErrorText>{form.error}</ErrorText>}
      <div className={styles.footer}>
        <Button disabled={form.submitting} onClick={banks.close}>
          Later
        </Button>
        <Button variant="primary" type="submit" disabled={!form.canSubmit}>
          {form.submitting ? "Adding…" : "Add accounts"}
        </Button>
      </div>
    </form>
  );
}
