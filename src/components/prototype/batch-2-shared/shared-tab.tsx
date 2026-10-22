"use client";

import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { IconButton } from "~/components/ui/icon-button";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "~/components/ui/segmented-control";
import { Tag } from "~/components/ui/tag";
import { moveMonth } from "~/components/budget/format";
import { Figure } from "../app-shell/cards";
import { money, type Category } from "../app-shell/model";
import { FieldError } from "../app-shell/move-money";
import shell from "../app-shell/shell.module.css";
import target from "../app-shell/target-editor.module.css";
import {
  monthOnly,
  PARTNER,
  purchaseEffect,
  TODAY,
  type Purchase,
  type Repayment,
  type SharedCategory,
} from "./data";
import {
  AccountSelect,
  centsText,
  DateInput,
  Field,
  NumberWell,
  parseCents,
  Select,
  shortDate,
} from "./fields";
import { net, splitLabel, useProto, verdict } from "./state";
import styles from "./batch2.module.css";

type View =
  | { type: "statement" }
  | { type: "detail"; id: string }
  | { type: "settle" }
  | { type: "opening" };

function initialView(open: string | null): View {
  if (open === "settle") return { type: "settle" };
  if (open === "opening") return { type: "opening" };
  if (open?.startsWith("detail:"))
    return { type: "detail", id: open.slice("detail:".length) };
  return { type: "statement" };
}

// The month details' Shared tab: what's owed and why, and the ways to
// settle it, all in place.
export function SharedTab({ categories }: { categories: Category[] }) {
  const { scenario, initialOpen } = useProto();
  const [view, setView] = useState<View>(() => initialView(initialOpen));
  // Where focus goes back to on the statement: the line or button that
  // opened the view being closed.
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const back = () => {
    setReturnTo(view.type === "detail" ? `line:${view.id}` : view.type);
    setView({ type: "statement" });
  };
  const name = (categoryId: string) =>
    categories.find((item) => item.id === categoryId)?.name ?? categoryId;

  if (view.type === "settle") return <SettleUp onClose={back} />;
  if (view.type === "opening")
    return <OpeningAmount name={name} onClose={back} />;
  if (view.type === "detail") {
    const shared = scenario.shared.find((item) => item.id === view.id);
    if (view.id === "opening")
      return <OpeningDetail name={name} onBack={back} />;
    if (shared)
      return <CategoryDetail shared={shared} name={name} onBack={back} />;
  }
  return (
    <Statement
      name={name}
      returnTo={returnTo}
      onOpen={(id) => setView({ type: "detail", id })}
      onSettle={() => setView({ type: "settle" })}
      onOpening={() => setView({ type: "opening" })}
    />
  );
}

function Statement({
  name,
  returnTo,
  onOpen,
  onSettle,
  onOpening,
}: {
  name: (categoryId: string) => string;
  returnTo: string | null;
  onOpen: (id: string) => void;
  onSettle: () => void;
  onOpening: () => void;
}) {
  const { scenario, variants, canRecord, initialOpen } = useProto();
  const [expanded, setExpanded] = useState<string[]>([]);
  const [receiving, setReceiving] = useState<string | null>(
    initialOpen === "receive"
      ? (scenario.repayments.find(
          (item) => item.from === "partner" && !item.receivedOn,
        )?.id ?? null)
      : null,
  );
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!returnTo) return;
    // A full settlement removes Settle up, so focus lands on the
    // statement, whose figure now says what changed.
    (
      container.current?.querySelector<HTMLElement>(
        `[data-return="${CSS.escape(returnTo)}"]`,
      ) ?? container.current
    )?.focus({ preventScroll: true });
  }, [returnTo]);
  const balance = net(scenario);
  const month = monthOnly(scenario.month);
  const openings = scenario.shared.flatMap((item) => item.opening);
  const canSettle = canRecord && balance > 0;

  if (!scenario.shared.length && !scenario.repayments.length)
    return (
      <div className={shell.tabEmpty}>
        <strong className={shell.tabEmptyTitle}>
          Nothing shared with {PARTNER} yet
        </strong>
        <p>
          Share a category like Rent or Groceries from its details. Purchases
          either of you make in it show up here, with what each of you owes.
        </p>
      </div>
    );

  const toggle = (id: string) =>
    setExpanded((values) =>
      values.includes(id)
        ? values.filter((value) => value !== id)
        : [...values, id],
    );
  const drill = variants.detail === "drill";
  const lineProps = (id: string) =>
    drill
      ? { onClick: () => onOpen(id), "data-return": `line:${id}` }
      : {
          onClick: () => toggle(id),
          "aria-expanded": expanded.includes(id),
        };

  return (
    <div ref={container} className={styles.statement} tabIndex={-1}>
      <div className={styles.figureRow} data-direction={direction(balance)}>
        <Figure
          value={money(Math.abs(balance))}
          caption={
            balance > 0
              ? `You owe ${PARTNER}`
              : balance < 0
                ? `${PARTNER} owes you`
                : verdict(scenario)
          }
        />
      </div>

      {canSettle && (
        <div className={shell.cardActions}>
          <Button variant="primary" data-return="settle" onClick={onSettle}>
            Settle up
          </Button>
        </div>
      )}
      {canRecord && balance < 0 && (
        <p className={styles.note}>
          {PARTNER} settles up from their budget. You confirm here when the
          money arrives.
        </p>
      )}
      {!canRecord && (
        <p className={styles.note}>
          This is {month}&rsquo;s statement. Settle up and confirm payments from{" "}
          {monthOnly("2026-10")}.
        </p>
      )}

      <section aria-label={`${month} shared statement`}>
        <h3 className={styles.sectionLabel}>By category</h3>
        <ul className={styles.lines}>
          {openings.length > 0 && (
            <li>
              <Line
                {...lineProps("opening")}
                drill={drill}
                label="Opening amounts"
                count={openings.length}
                effect={openings.reduce((sum, item) => sum + item.effect, 0)}
              />
              {!drill && expanded.includes("opening") && (
                <OpeningList name={name} />
              )}
            </li>
          )}
          {scenario.carried !== 0 && (
            <li>
              <div className={styles.line} data-static>
                <span className={styles.lineName}>
                  Carried from {monthOnly(moveMonth(scenario.month, -1))}
                </span>
                <Direction effect={scenario.carried} />
              </div>
            </li>
          )}
          {scenario.shared.map((shared) => {
            const effect = shared.purchases.reduce(
              (sum, item) => sum + purchaseEffect(item),
              0,
            );
            return (
              <li key={shared.id}>
                <Line
                  {...lineProps(shared.id)}
                  drill={drill}
                  label={name(shared.categoryId)}
                  split={splitLabel(shared.yourPercent)}
                  effect={effect}
                  empty={!shared.purchases.length}
                />
                {!drill && expanded.includes(shared.id) && (
                  <Purchases shared={shared} name={name} />
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {scenario.repayments.length > 0 && (
        <section aria-label="Payments between you">
          <h3 className={styles.sectionLabel}>Payments</h3>
          <ul className={styles.lines}>
            {scenario.repayments.map((repayment) => (
              <li key={repayment.id}>
                <RepaymentLine
                  repayment={repayment}
                  quiet={canSettle}
                  receiving={receiving === repayment.id}
                  onReceive={() => setReceiving(repayment.id)}
                  onClose={() => setReceiving(null)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {canRecord && scenario.shared.length > 0 && (
        <div className={styles.footerActions}>
          <Button variant="quiet" data-return="opening" onClick={onOpening}>
            Add opening amount
          </Button>
        </div>
      )}
    </div>
  );
}

const direction = (effect: number) =>
  effect > 0 ? "you-owe" : effect < 0 ? "owed" : "even";

// What a line adds to the balance, in words and color: owed to you is an
// inflow (--money-positive); what you owe stays primary, like an outflow.
function Direction({ effect }: { effect: number }) {
  if (effect === 0) return <span className={styles.dirEven}>Even</span>;
  return (
    <span className={styles.direction} data-direction={direction(effect)}>
      <span className={styles.dirWord}>
        {effect > 0 ? "you owe" : "owes you"}
      </span>
      <span className={styles.dirAmount}>{money(Math.abs(effect))}</span>
    </span>
  );
}

function Line({
  label,
  count,
  split,
  effect,
  empty,
  drill,
  ...button
}: {
  label: string;
  count?: number;
  split?: string;
  effect: number;
  empty?: boolean;
  drill: boolean;
  onClick: () => void;
  "aria-expanded"?: boolean;
  "data-return"?: string;
}) {
  const expanded = button["aria-expanded"];
  return (
    <button type="button" className={styles.line} {...button}>
      {!drill && (
        <ChevronDownIcon
          size={12}
          strokeWidth={2.5}
          className={styles.caret}
          data-open={expanded ? true : undefined}
          aria-hidden
        />
      )}
      <span className={styles.lineName}>
        <span className={shell.truncate}>{label}</span>
        {count ? <span className={styles.count}>{count}</span> : null}
        {split && <span className={styles.split}>{split}</span>}
      </span>
      {empty ? (
        <span className={styles.dirEven}>No purchases</span>
      ) : (
        <Direction effect={effect} />
      )}
      {drill && (
        <ChevronRightIcon size={13} className={styles.chevron} aria-hidden />
      )}
    </button>
  );
}

function CategoryDetail({
  shared,
  name,
  onBack,
}: {
  shared: SharedCategory;
  name: (categoryId: string) => string;
  onBack: () => void;
}) {
  const { scenario } = useProto();
  const label = name(shared.categoryId);
  const effect = shared.purchases.reduce(
    (sum, item) => sum + purchaseEffect(item),
    0,
  );
  return (
    <div className={styles.statement}>
      <DetailHeader
        title={label}
        subtitle={`${monthOnly(scenario.month)} · split ${splitLabel(shared.yourPercent)}, you pay ${shared.yourPercent}%`}
        onBack={onBack}
      />
      <Purchases shared={shared} name={name} />
      {shared.purchases.length > 0 && (
        <div className={styles.total}>
          <span>Total</span>
          <Direction effect={effect} />
        </div>
      )}
    </div>
  );
}

function DetailHeader({
  title,
  subtitle,
  onBack,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector("button")?.focus({ preventScroll: true });
  }, []);
  return (
    <div ref={ref} className={styles.detailHead}>
      <IconButton size="sm" label="Back to statement" onClick={onBack}>
        <ChevronLeftIcon aria-hidden />
      </IconButton>
      <div>
        <strong className={shell.truncate}>{title}</strong>
        <span>{subtitle}</span>
      </div>
    </div>
  );
}

function Purchases({
  shared,
}: {
  shared: SharedCategory;
  name: (categoryId: string) => string;
}) {
  const { scenario } = useProto();
  if (!shared.purchases.length)
    return (
      <p className={styles.detailEmpty}>
        No shared purchases in {monthOnly(scenario.month)} yet.
      </p>
    );
  return (
    <ul className={styles.purchases}>
      {shared.purchases.map((purchase) => (
        <PurchaseRow
          key={purchase.id}
          purchase={purchase}
          percent={shared.yourPercent}
        />
      ))}
    </ul>
  );
}

function PurchaseRow({
  purchase,
  percent,
}: {
  purchase: Purchase;
  percent: number;
}) {
  const effect = purchaseEffect(purchase);
  const ruleShare = Math.round((purchase.amount * percent) / 100);
  const yours = Math.round((purchase.yourShare / purchase.amount) * 100);
  const differs = ruleShare !== purchase.yourShare;
  return (
    <li className={styles.purchase}>
      <span className={styles.purchaseName}>
        <span className={shell.truncate}>{purchase.payee}</span>
        {differs && <Tag>{splitLabel(yours)}</Tag>}
        {purchase.pending && <Tag>Pending</Tag>}
        {purchase.forMonth && <Tag>For {monthOnly(purchase.forMonth)}</Tag>}
      </span>
      <span className={styles.purchasePaid}>{money(purchase.amount)}</span>
      <span className={styles.purchaseMeta}>
        {shortDate(purchase.date)} ·{" "}
        {purchase.paidBy === "you" ? "You paid" : `${PARTNER} paid`} · your
        share {money(purchase.yourShare)}
      </span>
      <Direction effect={effect} />
    </li>
  );
}

function OpeningDetail({
  name,
  onBack,
}: {
  name: (categoryId: string) => string;
  onBack: () => void;
}) {
  return (
    <div className={styles.statement}>
      <DetailHeader
        title="Opening amounts"
        subtitle="Owed from before Caishen, already split"
        onBack={onBack}
      />
      <OpeningList name={name} />
    </div>
  );
}

function OpeningList({ name }: { name: (categoryId: string) => string }) {
  const { scenario } = useProto();
  return (
    <ul className={styles.purchases}>
      {scenario.shared.flatMap((shared) =>
        shared.opening.map((item) => (
          <li key={item.id} className={styles.purchase}>
            <span className={styles.purchaseName}>
              <span className={shell.truncate}>{name(shared.categoryId)}</span>
            </span>
            <span />
            <span className={styles.purchaseMeta}>Not split again</span>
            <Direction effect={item.effect} />
          </li>
        )),
      )}
    </ul>
  );
}

function RepaymentLine({
  repayment,
  quiet,
  receiving,
  onReceive,
  onClose,
}: {
  repayment: Repayment;
  // Settle up is the tab's primary, so Confirm steps down beside it.
  quiet: boolean;
  receiving: boolean;
  onReceive: () => void;
  onClose: () => void;
}) {
  const { variants, actions, canRecord } = useProto();
  const fromYou = repayment.from === "you";
  const awaiting = !fromYou && !repayment.receivedOn;
  const confirmRef = useRef<HTMLButtonElement>(null);
  const wasReceiving = useRef(receiving);
  useEffect(() => {
    if (wasReceiving.current && !receiving)
      confirmRef.current?.focus({ preventScroll: true });
    wasReceiving.current = receiving;
  }, [receiving]);
  const confirm = () => {
    if (variants.receipt === "one-click")
      actions.receive(repayment.id, "chase", TODAY);
    else onReceive();
  };
  return (
    <div className={styles.repayment} data-open={receiving || undefined}>
      <div className={styles.line} data-static>
        <span className={styles.lineName}>
          <span className={shell.truncate}>
            {fromYou ? `You sent ${PARTNER}` : `${PARTNER} sent you`}
          </span>
          <span className={styles.count}>{shortDate(repayment.date)}</span>
        </span>
        <span className={styles.repaymentStatus}>
          {repayment.receivedOn ? (
            <span className={styles.received}>
              {fromYou ? `${PARTNER} confirmed` : "Received"}{" "}
              {shortDate(repayment.receivedOn)}
            </span>
          ) : fromYou ? (
            <Tag>Not confirmed</Tag>
          ) : canRecord && !receiving ? (
            <Button
              ref={confirmRef}
              size="sm"
              variant={quiet ? "quiet" : "quiet-primary"}
              onClick={confirm}
            >
              Confirm
            </Button>
          ) : (
            awaiting && !receiving && <Tag>Not confirmed</Tag>
          )}
        </span>
        <span
          className={styles.dirAmount}
          data-direction={fromYou ? "you-owe" : "owed"}
        >
          {money(repayment.amount)}
        </span>
      </div>
      {fromYou && !repayment.receivedOn && (
        <p className={styles.lineNote}>
          {PARTNER} confirms it when the money arrives.
        </p>
      )}
      {receiving && <ReceiptForm repayment={repayment} onClose={onClose} />}
    </div>
  );
}

function ReceiptForm({
  repayment,
  onClose,
}: {
  repayment: Repayment;
  onClose: () => void;
}) {
  const { actions } = useProto();
  const id = useId();
  const [account, setAccount] = useState("chase");
  const [date, setDate] = useState(TODAY);
  const [error, setError] = useState<{
    field: "date" | "form";
    message: string;
  } | null>(null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    ref.current?.querySelector("select")?.focus({ preventScroll: true });
    requestAnimationFrame(() =>
      ref.current?.scrollIntoView({ block: "nearest" }),
    );
  }, []);
  return (
    <form
      ref={ref}
      className={`${target.form} ${styles.receipt}`}
      noValidate
      aria-label={`Confirm ${money(repayment.amount)} from ${PARTNER}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (date < repayment.date) {
          setError({
            field: "date",
            message: `It can't arrive before ${PARTNER} sent it on ${shortDate(repayment.date)}.`,
          });
          return;
        }
        const blocked = actions.receive(repayment.id, account, date);
        if (blocked) setError({ field: "form", message: blocked });
        else onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <Field id={`${id}-account`} label="Arrived in">
        <AccountSelect
          id={`${id}-account`}
          value={account}
          onChange={setAccount}
        />
      </Field>
      <Field
        id={`${id}-date`}
        label="On"
        error={error?.field === "date" ? error.message : undefined}
        hint="It goes to Ready to Assign, not back into a category."
      >
        <DateInput
          id={`${id}-date`}
          label="Date received"
          value={date}
          min="2026-08-01"
          error={error?.field === "date" ? error.message : undefined}
          onChange={(value) => {
            setDate(value);
            setError(null);
          }}
        />
      </Field>
      {error?.field === "form" && (
        <FieldError id={`${id}-form-error`} message={error.message} />
      )}
      <div className={target.footer}>
        <span className={target.spacer} />
        <Button size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit">
          Confirm {money(repayment.amount)}
        </Button>
      </div>
    </form>
  );
}

function SettleUp({ onClose }: { onClose: () => void }) {
  const { scenario, variants, actions } = useProto();
  const id = useId();
  const balance = net(scenario);
  const [account, setAccount] = useState("chase");
  const [amountText, setAmountText] = useState(centsText(balance));
  const [date, setDate] = useState(TODAY);
  const [error, setError] = useState<{
    field: "amount" | "form";
    message: string;
  } | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLFormElement>(null);
  const editable = variants.amount === "editable";
  useEffect(() => {
    ref.current?.querySelector("select")?.focus({ preventScroll: true });
    requestAnimationFrame(() =>
      ref.current?.scrollIntoView({ block: "nearest" }),
    );
  }, []);
  const amount = editable ? parseCents(amountText) : balance;
  const left = amount !== null && amount < balance ? balance - amount : 0;

  const submit = () => {
    if (amount === null || amount <= 0) {
      setError({ field: "amount", message: "Enter an amount above zero." });
      amountRef.current?.focus();
      return;
    }
    if (amount > balance) {
      setError({
        field: "amount",
        message: `You owe ${money(balance)} after offsets. Enter that or less.`,
      });
      amountRef.current?.focus();
      return;
    }
    const blocked = actions.settle(amount, account, date);
    if (blocked) setError({ field: "form", message: blocked });
    else onClose();
  };

  return (
    <form
      ref={ref}
      className={target.form}
      noValidate
      aria-label={`Settle up with ${PARTNER}`}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className={styles.editorHead}>
        <strong>Settle up with {PARTNER}</strong>
        <span>Record a payment you&rsquo;ve made, or are making now.</span>
      </div>

      <dl className={styles.breakdown}>
        <div>
          <dt>You owe {PARTNER}</dt>
          <dd>{money(scenario.youOwe)}</dd>
        </div>
        {scenario.owedToYou > 0 && (
          <div>
            <dt>
              {PARTNER} owes you
              <span>Offset, no money moves</span>
            </dt>
            <dd>−{money(scenario.owedToYou)}</dd>
          </div>
        )}
        <div data-total>
          <dt>You pay</dt>
          <dd>{money(balance)}</dd>
        </div>
      </dl>

      <Field id={`${id}-account`} label="From">
        <AccountSelect
          id={`${id}-account`}
          value={account}
          onChange={setAccount}
        />
      </Field>
      <div className={styles.twoUp}>
        {editable && (
          <Field
            id={`${id}-amount`}
            label="Amount"
            error={error?.field === "amount" ? error.message : undefined}
          >
            <NumberWell
              id={`${id}-amount`}
              inputRef={amountRef}
              prefix="$"
              value={amountText}
              error={error?.field === "amount" ? error.message : undefined}
              onChange={(value) => {
                setAmountText(value);
                setError(null);
              }}
            />
          </Field>
        )}
        <Field id={`${id}-date`} label="Paid on">
          <DateInput
            id={`${id}-date`}
            label="Payment date"
            value={date}
            min="2026-10-01"
            onChange={setDate}
          />
        </Field>
      </div>
      <p className={target.hint}>
        {left > 0 ? `You'll still owe ${money(left)} after this. ` : ""}
        {PARTNER} confirms it when the money arrives.
        {scenario.owedToYou > 0 &&
          ` ${money(scenario.owedToYou)} of the cash you set aside goes back to Ready to Assign, since ${PARTNER}'s share covers it.`}
      </p>
      {error?.field === "form" && (
        <FieldError id={`${id}-form-error`} message={error.message} />
      )}
      <div className={target.footer}>
        <span className={target.spacer} />
        <Button size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit">
          Record {amount !== null && amount > 0 ? money(amount) : ""} payment
        </Button>
      </div>
    </form>
  );
}

function OpeningAmount({
  name,
  onClose,
}: {
  name: (categoryId: string) => string;
  onClose: () => void;
}) {
  const { scenario, actions } = useProto();
  const id = useId();
  const [sharedId, setSharedId] = useState(scenario.shared[0]?.id ?? "");
  const [youOwe, setYouOwe] = useState(true);
  const [amountText, setAmountText] = useState("");
  const [error, setError] = useState<{
    field: "amount" | "form";
    message: string;
  } | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    ref.current?.querySelector("select")?.focus({ preventScroll: true });
    requestAnimationFrame(() =>
      ref.current?.scrollIntoView({ block: "nearest" }),
    );
  }, []);
  return (
    <form
      ref={ref}
      className={target.form}
      noValidate
      aria-label="Add an opening amount"
      onSubmit={(event) => {
        event.preventDefault();
        const amount = parseCents(amountText);
        if (amount === null || amount <= 0) {
          setError({
            field: "amount",
            message: "Enter the amount owed, above zero.",
          });
          amountRef.current?.focus();
          return;
        }
        const blocked = actions.addOpening(sharedId, youOwe, amount);
        if (blocked) setError({ field: "form", message: blocked });
        else onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className={styles.editorHead}>
        <strong>Opening amount</strong>
        <span>
          What you and {PARTNER} already owed each other before Caishen. It
          isn&rsquo;t split again, isn&rsquo;t cash to assign, and doesn&rsquo;t
          count as {monthOnly(scenario.month)} spending.
        </span>
      </div>
      <Field id={`${id}-category`} label="Shared category">
        <Select id={`${id}-category`} value={sharedId} onChange={setSharedId}>
          {scenario.shared.map((shared) => (
            <option key={shared.id} value={shared.id}>
              {name(shared.categoryId)}
            </option>
          ))}
        </Select>
      </Field>
      <div className={target.field}>
        <span className={target.label} id={`${id}-direction`}>
          Who owes
        </span>
        <SegmentedControl
          fill
          aria-labelledby={`${id}-direction`}
          value={youOwe ? "you" : "partner"}
          onValueChange={(next) => setYouOwe(next === "you")}
        >
          <SegmentedControlItem value="you">
            I owe {PARTNER}
          </SegmentedControlItem>
          <SegmentedControlItem value="partner">
            {PARTNER} owes me
          </SegmentedControlItem>
        </SegmentedControl>
      </div>
      <Field
        id={`${id}-amount`}
        label="Amount, already split"
        error={error?.field === "amount" ? error.message : undefined}
        hint={`Enter ${youOwe ? "your" : `${PARTNER}'s`} part only. For $800 of rent split 50/50, that's $400.`}
      >
        <NumberWell
          id={`${id}-amount`}
          inputRef={amountRef}
          prefix="$"
          value={amountText}
          hint
          error={error?.field === "amount" ? error.message : undefined}
          onChange={(value) => {
            setAmountText(value);
            setError(null);
          }}
        />
      </Field>
      {error?.field === "form" && (
        <FieldError id={`${id}-form-error`} message={error.message} />
      )}
      <div className={target.footer}>
        <span className={target.spacer} />
        <Button size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit">
          Add opening amount
        </Button>
      </div>
    </form>
  );
}
