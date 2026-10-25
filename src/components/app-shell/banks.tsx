"use client";

import {
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  EllipsisIcon,
  InfoIcon,
  LandmarkIcon,
  ListChecksIcon,
  LoaderCircleIcon,
  PlusIcon,
  UnlinkIcon,
} from "lucide-react";
import { AlertDialog, Dialog, DropdownMenu, Popover } from "radix-ui";
import { createPortal } from "react-dom";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  accountSetupType,
  bankAccountMappings,
  useBankAccountSetupForm,
} from "~/components/banks/bank-account-setup";
import type {
  BankSetupState,
  ServerRunner,
} from "~/components/banks/bank-account-setup";
import { LoanSetupFields } from "~/components/banks/loan-setup-fields";
import { loadPlaid } from "~/components/banks/plaid-link-sdk";
import { usePlaidLink } from "~/components/banks/use-plaid-link";
import type { State } from "~/components/budget/types";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { IconButton } from "~/components/ui/icon-button";
import { usePortalContainer } from "~/components/ui/tooltip";
import { usePopoverMotion } from "~/components/ui/popover-motion";
import { POPOVER_GAP } from "~/components/ui/tokens";
import { syncedLabel } from "./model";
import { api } from "~/trpc/react";
import styles from "./banks.module.css";
import shell from "./shell.module.css";

type Connection = State["connections"][number];
type BankAccount = Connection["accounts"][number];
type Notify = (message: string, tone?: "neutral" | "attention") => void;

const bankName = (connection: Connection | undefined) =>
  connection?.institutionName ?? "your bank";

// Accounts the setup form supports, including loans with lender-entered terms.
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
  runOnServer,
  resumeReturn = false,
}: {
  state: BankSetupState & Pick<State, "services">;
  notify: Notify;
  holdOpen: () => () => void;
  runOnServer: ServerRunner;
  resumeReturn?: boolean;
}) {
  const link = usePlaidLink();
  const { isLoaded, userId, resume, cancel } = link;
  useEffect(() => {
    if (!resumeReturn || !isLoaded || !userId) return;
    void resume();
    return cancel;
  }, [resumeReturn, isLoaded, userId, resume, cancel]);
  const [setupId, setSetupId] = useState<string | null>(null);
  const [disconnectId, setDisconnectId] = useState<string | null>(null);
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
  const disconnect = state.connections.find((item) => item.id === disconnectId);
  const view: DialogView | null = disconnect
    ? { type: "disconnect", connection: disconnect }
    : setup
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
    error: link.error,
    saved: link.saved,
    connections: state.connections.filter(
      (item) =>
        !item.disconnectedAt ||
        bankAccountMappings(item.accountMappings).size > 0,
    ),
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
    runOnServer,
    start: (connectionId?: string) => {
      reconnect.current = Boolean(connectionId);
      setDismissed(false);
      void link.start(connectionId);
    },
    setUp: (connectionId: string) => setSetupId(connectionId),
    disconnect: (connectionId: string) => setDisconnectId(connectionId),
    retrySync: () => void link.retrySync(),
    close: () => {
      setSetupId(null);
      setDisconnectId(null);
      setDismissed(true);
    },
  };
}

type DialogView =
  | { type: "disconnect"; connection: Connection }
  | { type: "progress"; phase: "saving" | "syncing" }
  | { type: "sync-failed"; error: string }
  | { type: "elsewhere"; origin: string }
  | { type: "setup"; connection: Connection };

export type BankConnections = Omit<
  ReturnType<typeof useBankConnections>,
  "error" | "saved"
> & { error?: string; saved?: boolean };

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
  const motion = usePopoverMotion(open);
  // Opened from the keyboard it appears at once and focuses its first
  // control; a click animates and leaves focus on the popover itself.
  const attention = banks.connections.some((item) => item.error);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={styles.trigger}
          aria-busy={banks.opening || undefined}
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
          {...motion}
          className={styles.popover}
          side="top"
          align="start"
          sideOffset={POPOVER_GAP}
          collisionPadding={{ top: 12, right: 12, bottom: 12, left: 0 }}
          aria-labelledby={`${id}-title`}
          onOpenAutoFocus={(event) => {
            if (motion["data-instant"]) return;
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
  const container = usePortalContainer();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuMotion = usePopoverMotion(menuOpen);
  const mappings = bankAccountMappings(connection.accountMappings);
  const budget = banks.state.view?.budget;
  // A partial bank response changes access, not membership in the budget.
  const inBudget = [...mappings].flatMap(([providerId, mapping]) => {
    const account = connection.accounts.find(
      (item) => item.accountId === providerId,
    );
    const saved =
      budget?.accounts.find((item) => item.id === mapping.accountId) ??
      budget?.loans.find((item) => item.id === mapping.accountId);
    const name = saved?.name ?? account?.name;
    const shared =
      Boolean(account) &&
      !connection.unavailableAccountIds?.includes(providerId);
    return name ? [{ providerId, account, name, shared }] : [];
  });
  const notShared = inBudget.filter(({ shared }) => !shared).length;
  const outside = connection.accounts.filter(
    (account) => !mappings.has(account.accountId),
  ).length;
  const addable = addableAccounts(connection).length > 0;
  const reconnecting = banks.reconnecting === connection.id;
  const institution = bankName(connection);
  // Plaid's script is large; fetch it while the pointer is on the way.
  const preload = () => void loadPlaid().catch(() => undefined);
  return (
    <li className={styles.bank}>
      <div className={styles.bankHeader}>
        <div className={styles.bankTitle}>
          <strong className={styles.bankName}>{institution}</strong>
          {connection.disconnectedAt ? (
            <span className={styles.note}>Disconnected</span>
          ) : (
            <BankStatus connection={connection} />
          )}
        </div>
        {(connection.disconnectedAt ?? connection.error) && (
          <Button
            size="sm"
            // Repairing the sole broken connection is the popover's main
            // action.
            variant={
              connection.error &&
              !connection.disconnectedAt &&
              banks.connections.filter((item) => item.error).length === 1
                ? "quiet-primary"
                : "quiet"
            }
            disabled={!banks.available || banks.busy}
            onPointerEnter={preload}
            onClick={() => {
              onAction();
              banks.start(
                connection.disconnectedAt ? undefined : connection.id,
              );
            }}
          >
            {connection.disconnectedAt
              ? "Link again"
              : reconnecting
                ? "Reconnecting…"
                : "Reconnect"}
          </Button>
        )}
        {!connection.disconnectedAt && (
          <DropdownMenu.Root
            modal={false}
            open={menuOpen}
            onOpenChange={setMenuOpen}
          >
            <DropdownMenu.Trigger asChild>
              <IconButton size="sm" label={`${institution} options`}>
                <EllipsisIcon aria-hidden />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal container={container}>
              <DropdownMenu.Content
                {...menuMotion}
                className={`${shell.menu} ${styles.bankMenu}`}
                align="end"
                sideOffset={POPOVER_GAP}
                collisionPadding={12}
              >
                {outside > 0 && (
                  <BankMenuItem
                    icon={<PlusIcon size={14} aria-hidden />}
                    title={`${addable ? "Add" : "Review"} ${outside} ${outside === 1 ? "account" : "accounts"}`}
                    detail={
                      addable
                        ? "Bring them into your budget"
                        : "See why they can’t be added yet"
                    }
                    disabled={banks.busy}
                    onSelect={() => {
                      onAction();
                      banks.setUp(connection.id);
                    }}
                  />
                )}
                {!connection.error && (
                  <BankMenuItem
                    icon={<ListChecksIcon size={14} aria-hidden />}
                    title="Choose shared accounts"
                    detail={
                      notShared
                        ? `Restore updates for ${notShared} not shared`
                        : `Change what ${institution} shares`
                    }
                    disabled={!banks.available || banks.busy}
                    onPointerEnter={preload}
                    onSelect={() => {
                      onAction();
                      banks.start(connection.id);
                    }}
                  />
                )}
                <DropdownMenu.Separator className={shell.menuSeparator} />
                <BankMenuItem
                  icon={<UnlinkIcon size={14} aria-hidden />}
                  title="Disconnect…"
                  detail="Your accounts and history stay"
                  disabled={banks.busy}
                  onSelect={() => {
                    onAction();
                    banks.disconnect(connection.id);
                  }}
                />
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
      </div>
      {inBudget.length > 0 && (
        <ul
          className={styles.accounts}
          aria-label={`${institution} accounts in your budget`}
        >
          {inBudget.map(({ providerId, account, name, shared }) => (
            <li key={providerId} className={styles.account}>
              <span className={styles.accountName}>
                {name}
                {account?.mask && (
                  <span className={styles.mask}> ••{account.mask}</span>
                )}
              </span>
              <span className={styles.balance}>
                {account && shared
                  ? (bankBalance(account) ?? "Balance unavailable")
                  : connection.disconnectedAt
                    ? "Disconnected"
                    : "Not shared"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!connection.disconnectedAt && outside > 0 && (
        <p className={styles.meta}>
          {inBudget.length
            ? `${outside} more not added`
            : `${outside} ${outside === 1 ? "account" : "accounts"} not added`}
        </p>
      )}
    </li>
  );
}

// A menu row that says why you'd pick it, so the popover itself can stay
// balances only.
function BankMenuItem({
  icon,
  title,
  detail,
  ...props
}: Omit<ComponentProps<typeof DropdownMenu.Item>, "className" | "title"> & {
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <DropdownMenu.Item
      className={`${shell.menuItem} ${styles.bankMenuItem}`}
      {...props}
    >
      {icon}
      <span className={styles.bankMenuText}>
        <span className={styles.bankMenuTitle}>{title}</span>
        <span className={styles.bankMenuDetail}>{detail}</span>
      </span>
    </DropdownMenu.Item>
  );
}

// A toggletip: hover shows the bank's status, and a click or tap pins it,
// since a touch screen can't hover and the reason a bank needs reconnecting
// must be reachable there too. The visible signal (the alert icon and the
// Reconnect button) never depends on opening it.
export function BankStatus({ connection }: { connection: Connection }) {
  const container = usePortalContainer();
  const [open, setOpen] = useState(false);
  const motion = usePopoverMotion(open);
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
          {...motion}
          className={styles.tip}
          side="top"
          sideOffset={POPOVER_GAP}
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
  if (view?.type === "disconnect")
    return <DisconnectDialog connection={view.connection} />;
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

function DisconnectDialog({ connection }: { connection: Connection }) {
  const banks = useBanks();
  const container = usePortalContainer();
  const utils = api.useUtils();
  const disconnect = api.budget.disconnectBank.useMutation();
  const [operationId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const submit = async () => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await banks.runOnServer(
        operationId,
        (expectedRevision) =>
          disconnect.mutateAsync({
            connectionId: connection.id,
            operationId,
            expectedRevision,
          }),
        "Disconnected bank",
      );
      await utils.budget.invalidate();
      banks.close();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Your bank couldn’t be disconnected. Try again.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return (
    <AlertDialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !saving.current) banks.close();
      }}
    >
      <AlertDialog.Portal container={container}>
        <AlertDialog.Overlay className={styles.overlay} />
        <AlertDialog.Content className={styles.dialog}>
          <div className={styles.header}>
            <AlertDialog.Title className={styles.title}>
              Disconnect {bankName(connection)}?
            </AlertDialog.Title>
            <AlertDialog.Description className={styles.description}>
              Bank updates will stop. Your accounts, transactions, and activity
              awaiting review will stay in your budget. To replace this
              connection, choose Link again afterward. Review outstanding
              activity and reconcile your cash and credit accounts to today’s
              bank balances before linking them to the new connection.
            </AlertDialog.Description>
          </div>
          {error && <ErrorText>{error}</ErrorText>}
          <div className={styles.footer}>
            <AlertDialog.Cancel asChild>
              <Button disabled={busy}>Cancel</Button>
            </AlertDialog.Cancel>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? "Disconnecting…" : "Disconnect"}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
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
    runOnServer: banks.runOnServer,
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
  // Unsupported accounts (such as retirement accounts) fold into one
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
          {form.rows.some((row) => row.recovery || row.requiresExisting)
            ? `Set up ${bankName(connection)} accounts`
            : `Add ${bankName(connection)} to your budget`}
        </Dialog.Title>
        <p className={styles.description}>
          Checking and savings go in Cash, credit cards in Credit, and loans in
          Loans. New cash and credit accounts start with your current balance.
          Earlier purchases are included in your Starting Balance. Review loan
          balances and terms before adding.
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
              recovery,
              requiresExisting,
            }) => {
              const fieldId = `${id}-${account.accountId}`;
              const selectable = !addedAs && synchronized && Boolean(draft);
              const hint = recovery
                ? "Keeps this account’s history and balance. Review outstanding bank activity and reconcile it to today’s bank balance first. Earlier posted activity won’t be imported again."
                : draft?.existingAccountId
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
                      {recovery ? (
                        <p className={styles.note}>Link to existing account</p>
                      ) : draft.existingAccountId ? (
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
                          <label htmlFor={`${fieldId}-as`}>
                            {requiresExisting || recovery
                              ? "Link to"
                              : "Add as"}
                          </label>
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
                            <option value="" disabled={requiresExisting}>
                              {requiresExisting
                                ? "Choose an existing account"
                                : account.type === "loan"
                                  ? "New loan"
                                  : "New account"}
                            </option>
                            {existingAccounts.map((existing) => (
                              <option key={existing.id} value={existing.id}>
                                {existing.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      {account.type === "loan" && !draft.existingAccountId && (
                        <LoanSetupFields
                          id={fieldId}
                          currentBalance={account.currentBalance}
                          draft={draft}
                          busy={busy}
                          fieldError={fieldError}
                          errorId={`${fieldId}-hint`}
                          onChange={(next) =>
                            form.change(account.accountId, next)
                          }
                        />
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
