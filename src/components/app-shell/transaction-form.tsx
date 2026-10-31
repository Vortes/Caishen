"use client";

import {
  classifyRegisterEntry,
  directEntryAccounts,
  accountKindLabels,
} from "~/domain/register-entry";
import { earlierPayees } from "~/domain/payee-memory";
import { transferNeedsCategory } from "~/domain/transfers";
import { cardPaymentCategoryLabel } from "~/components/transactions/transaction-category";
import { CircleAlertIcon, PlusIcon, SplitIcon, XIcon } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { readAmount, sameAmount } from "~/components/budget/amount";
import { newId, today } from "~/components/budget/format";
import {
  READY_TO_ASSIGN,
  SPLIT,
  amountFields,
  draftAmount,
  draftShareFacts,
  lineField,
  paymentPayees,
  splitRemaining,
  type DraftLine,
  type DraftShare,
} from "~/components/transactions/transaction-draft";
import type { CounterpartyShare } from "~/domain/engine";
import { AmountInput } from "~/components/ui/amount-input";
import { DateField, type DateFieldHandle } from "~/components/ui/date-field";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { FieldButton } from "~/components/ui/field-button";
import { IconButton } from "~/components/ui/icon-button";
import {
  SearchList,
  SearchSuggestions,
  type SearchListOption,
} from "~/components/ui/search-list";
import { TextInput } from "~/components/ui/text-input";
import { partnerMatchesOf } from "~/components/transactions/import-draft";
import { money } from "./model";
import { PartnerMatches } from "./partner-match";
import { NewCategoryPopover, type NewCategory } from "./add-category";
import { useTransactionEntry, type DraftField } from "./transaction-entry";
import { ShareLabel, ShareMenu } from "./share-field";
import { ClearedMark, clearedState } from "./cleared-mark";
import { EditorCell, EditorFooter, EditorForm } from "./editor-row";
import { TransactionCategoryField } from "./transaction-category-field";
import shell from "./shell.module.css";
import shareStyles from "./share.module.css";
import styles from "./transaction-entry.module.css";

// The open editor: a row in the register, under its column headers.
// accountColumn is whether the register shows accounts.
export function TransactionEditor({
  accountColumn = false,
}: {
  accountColumn?: boolean;
}) {
  const { session } = useTransactionEntry();
  if (!session) return null;
  return <TransactionForm key={session.key} accountColumn={accountColumn} />;
}

type Control = DraftField | "error" | "addLine";

function TransactionForm({ accountColumn }: { accountColumn: boolean }) {
  const entry = useTransactionEntry();
  const session = entry.session!;
  const { view, removed } = entry;
  const { draft, fields, initial } = session;
  const editing = Boolean(session.rowId);
  const formId = useId();
  const controls = useRef<Partial<Record<Control, HTMLElement | null>>>({});
  const dateField = useRef<DateFieldHandle>(null);
  const register = (name: Control) => (element: HTMLElement | null) => {
    controls.current[name] = element;
  };
  // The name typed in Category while its Add form is open.
  const [creating, setCreating] = useState<string | null>(null);
  // A category added from here, shown as the choice until the plan has it,
  // and the one whose add failed, which the draft lets go of.
  const [added, setAdded] = useState<NewCategory | null>(null);
  const [lost, setLost] = useState<string | null>(null);
  useEffect(() => {
    if (lost && draft.categoryId === lost) entry.change({ categoryId: "" });
  }, [lost, draft.categoryId, entry]);

  // A field to focus once the next render shows it, such as a line just
  // added.
  const focusNext = useRef<Control | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    controls.current[target]?.focus({ preventScroll: true });
  });

  // Takes the controller's pending focus move once this editor is on screen.
  // Opening focuses a text field only with a mouse or trackpad, so a touch
  // keyboard doesn't cover the form before it's read. The calendar has no
  // keyboard, so it takes focus everywhere.
  useEffect(() => {
    const request = entry.takeFocus();
    if (!request) return;
    if (request.target === "calendar") {
      dateField.current?.focusCalendar();
      return;
    }
    if (request.auto && !window.matchMedia("(pointer: fine)").matches) return;
    const element = controls.current[request.target];
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: "nearest" });
  });

  const account = view.accounts.find((item) => item.id === draft.accountId);
  const matches = session.imported ? partnerMatchesOf(session.imported) : [];
  const destinations = paymentPayees(view, draft);
  const destination = destinations.find((item) =>
    item.accountId
      ? item.accountId === draft.transferAccountId
      : item.loanId === draft.loanId,
  );
  const loan = view.budget.loans.find((item) => item.id === draft.loanId);
  const draftCents = draftAmount(draft) ?? 0;
  const draftEntry = account
    ? classifyRegisterEntry(view.budget, {
        id: initial?.id ?? session.key,
        accountId: account.id,
        date: draft.date,
        payee: draft.payee,
        amount: draftCents === 0 ? (draft.inflow ? 1 : -1) : draftCents,
        status: draft.status,
        transferAccountId: draft.transferAccountId || undefined,
        loanId: draft.loanId || undefined,
        categoryId:
          draft.categoryId === READY_TO_ASSIGN
            ? undefined
            : draft.categoryId || undefined,
        ...draftShareFacts(draft),
      })
    : undefined;
  const initialEntry = initial
    ? classifyRegisterEntry(view.budget, initial)
    : undefined;
  const boundary = draftEntry?.fields.category === "boundary";
  const categoryNotNeeded = draftEntry?.fields.category === "none";
  const budgetInflow = (draftEntry?.fields.budgetAmount ?? 0) > 0;
  const splittable = draftEntry?.fields.split ?? false;
  const split = draft.lines.length > 0;
  const remaining = split ? splitRemaining(draft) : undefined;
  const shareable = draftEntry?.capabilities.share.mode !== "none";
  // The share a new transaction took from its payee's memory, until the
  // user picks one.
  const remembered =
    !session.initial && !session.shareChosen && draft.counterpartyShare
      ? draft.payee.trim()
      : undefined;
  const accountOptions = useMemo<SearchListOption[]>(
    () =>
      directEntryAccounts(view.accounts).map((item) => ({
        value: item.id,
        label: item.name,
        group: accountKindLabels[item.kind],
      })),
    [view.accounts],
  );
  const spendingOptions: SearchListOption[] = view.categories
    .filter(
      (category) =>
        !category.pairedAccountId &&
        !category.counterpartyAccountId &&
        (loan ? category.pairedLoanId === loan.id : !category.pairedLoanId),
    )
    .map((category) => ({
      value: category.id,
      label: category.name,
      group: category.group,
      amount: category.available,
    }));
  const categoryOptions: SearchListOption[] = [
    {
      value: READY_TO_ASSIGN,
      label: "Ready to Assign",
      group: "Inflow",
      amount: view.readyToAssign,
      disabled:
        (boundary ? !budgetInflow : !draftEntry?.fields.readyToAssign) ||
        (Boolean(initial?.categoryId) &&
          !boundary &&
          initial !== undefined &&
          !initialEntry?.fields.clearCategory),
    },
    ...spendingOptions,
  ];
  if (
    added &&
    added.id !== lost &&
    !view.categories.some((item) => item.id === added.id)
  ) {
    // Under its group's other categories, so the group heads it once.
    const last = categoryOptions
      .map((option) => option.group)
      .lastIndexOf(added.group);
    categoryOptions.splice(last < 0 ? categoryOptions.length : last + 1, 0, {
      value: added.id,
      label: added.name,
      group: added.group,
    });
  }
  const payees = useMemo(() => earlierPayees(view.budget), [view.budget]);
  const startDate = `${view.budget.startMonth}-01`;
  const minDate =
    account && account.date > startDate ? account.date : startDate;

  const id = (field: DraftField) => `${formId}-${field}`;
  // One message about both amounts shows once, across their two columns.
  const amountError =
    fields.outflow && fields.outflow === fields.inflow ? fields.outflow : "";
  const amountErrorId = `${formId}-amount-error`;
  const shownOnce = (field: DraftField) =>
    Boolean(amountError) && (field === "outflow" || field === "inflow");
  const cell = (
    name: DraftField,
    column: string,
    label: string,
    control: ReactNode,
  ) => (
    <EditorCell
      column={column}
      label={label}
      id={id(name)}
      error={shownOnce(name) ? undefined : fields[name]}
      sharedErrorId={shownOnce(name) ? amountErrorId : undefined}
    >
      {control}
    </EditorCell>
  );
  // Outflow and inflow are one amount: typing in one clears the other.
  // Leaving one rewrites it as its result, which clears nothing.
  const amountChange = (
    before: { outflow: string; inflow: string },
    name: "outflow" | "inflow",
    value: string,
  ) => {
    const other = name === "outflow" ? "inflow" : "outflow";
    return {
      [name]: value,
      ...(value.trim() && !sameAmount(before[name], value)
        ? { [other]: "" }
        : {}),
    };
  };
  const amount = (name: "outflow" | "inflow") => (
    <AmountInput
      inputRef={register(name)}
      name={name}
      placeholder={name === "outflow" ? "Outflow" : "Inflow"}
      align="end"
      value={draft[name]}
      onChange={(value) => entry.change(amountChange(draft, name, value))}
    />
  );
  // Taking a choice moves on to the next field, which opens its own list.
  // Touch keeps focus where it is, so a keyboard doesn't open over the form.
  const advance = (to: DraftField) => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    entry.focus(to);
  };
  const todayKey = today(view.budget.settings.timezone);
  const dateControl = (
    <DateField
      handle={dateField}
      name="date"
      value={draft.date}
      min={minDate}
      // Activity is recorded once it happened, so no later day can be picked.
      max={todayKey}
      today={todayKey}
      open={session.calendarOpen}
      inputRef={register("date")}
      onOpenChange={entry.setCalendarOpen}
      onChange={(date) => entry.change({ date })}
      onPicked={() => advance("payee")}
      onAdvance={() => controls.current.payee?.focus({ preventScroll: true })}
    />
  );
  const payeeControl = (
    <SearchSuggestions
      value={destination?.label ?? draft.payee}
      suggestions={payees}
      destinations={destinations.map((item) => ({
        value: item.value,
        label: item.label,
        group: "Payments and Transfers",
      }))}
      destination={destination?.value}
      maxLength={240}
      onDestination={(value) => {
        const selected = destinations.find((item) => item.value === value);
        if (!selected) return;
        entry.change({
          payee: selected.label,
          transferAccountId: selected.accountId,
          loanId: selected.loanId,
          ...(selected.loanId !== draft.loanId ? { interest: "" } : {}),
          categoryId: selected.loanId
            ? view.budget.loans.find((item) => item.id === selected.loanId)!
                .categoryId
            : account &&
                selected.accountId &&
                transferNeedsCategory(
                  account,
                  view.accounts.find((item) => item.id === selected.accountId)!,
                )
              ? draft.categoryId || (budgetInflow ? READY_TO_ASSIGN : "")
              : "",
        });
      }}
      placeholder="Payee"
      inputRef={register("payee")}
      onChange={(payee) =>
        entry.change({
          payee,
          transferAccountId: "",
          loanId: "",
          ...(draft.loanId ? { categoryId: "" } : {}),
        })
      }
      onPicked={(value) => {
        const selected = destinations.find((item) => item.value === value);
        if (
          selected?.accountId &&
          account &&
          !transferNeedsCategory(
            account,
            view.accounts.find((item) => item.id === selected.accountId)!,
          )
        )
          advance(selected.label.includes(" from ") ? "inflow" : "outflow");
        else if (!selected && categoryNotNeeded) advance("outflow");
        else advance("categoryId");
      }}
    />
  );
  // Splitting keeps the chosen category and the amount on the first line,
  // and adds an empty second line. The total comes first when it's still
  // empty, then the lines.
  const startSplit = () => {
    const lines: DraftLine[] = [
      {
        lineId: newId(),
        categoryId: spendingOptions.some(
          (option) => option.value === draft.categoryId,
        )
          ? draft.categoryId
          : "",
        ...amountFields(draftAmount(draft) ?? 0),
        counterpartyShare: draft.counterpartyShare,
      },
      { lineId: newId(), categoryId: "", outflow: "", inflow: "" },
    ];
    entry.change({ categoryId: "", lines, counterpartyShare: undefined }, true);
    return lines;
  };
  // The lines a split started with, until the editor shows them.
  const splitLines = useRef<DraftLine[] | null>(null);
  // Choosing one category ends a split.
  const chooseCategory = (
    categoryId: string,
    counterpartyShare?: DraftShare | null,
  ) => {
    if (categoryId === SPLIT) {
      if (!split) splitLines.current = startSplit();
    } else if (counterpartyShare !== undefined)
      entry.change({ categoryId, counterpartyShare, lines: [] }, true);
    else entry.chooseCategory(categoryId);
  };
  const changeLine = (lineId: string, next: Partial<DraftLine>) =>
    entry.change({
      lines: draft.lines.map((line) =>
        line.lineId === lineId ? { ...line, ...next } : line,
      ),
    });
  // A line's category takes what's left of the amount when the line has
  // none yet, so the last line usually needs no typing.
  const chooseLineCategory = (
    line: DraftLine,
    categoryId: string,
    counterpartyShare?: DraftShare | null,
  ) =>
    changeLine(line.lineId, {
      categoryId,
      ...(counterpartyShare !== undefined ? { counterpartyShare } : {}),
      ...(!line.outflow.trim() && !line.inflow.trim() && remaining
        ? amountFields(remaining)
        : {}),
    });
  const lineAmountField = (line: DraftLine) =>
    lineField(
      line.lineId,
      line.inflow.trim() || (!line.outflow.trim() && (remaining ?? 0) > 0)
        ? "inflow"
        : "outflow",
    );
  const addLine = () => {
    const line: DraftLine = {
      lineId: newId(),
      categoryId: "",
      ...amountFields(remaining ?? 0),
    };
    entry.change({ lines: [...draft.lines, line] });
    focusNext.current = lineField(line.lineId, "categoryId");
  };
  // Removing the second-to-last line ends the split: the one left becomes
  // the transaction's category.
  const removeLine = (lineId: string) => {
    const rest = draft.lines.filter((line) => line.lineId !== lineId);
    if (rest.length > 1) {
      entry.change({ lines: rest });
      focusNext.current = "addLine";
    } else {
      entry.change({
        lines: [],
        categoryId: rest[0]?.categoryId ?? "",
        counterpartyShare: rest[0]?.counterpartyShare,
      });
      focusNext.current = "outflow";
    }
  };
  // Ready to Assign only takes an inflow.
  const afterCategory = (categoryId: string) => {
    if (categoryId !== SPLIT) {
      afterSingleCategory(categoryId);
      return;
    }
    const first = (splitLines.current ?? draft.lines)[0];
    splitLines.current = null;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    focusNext.current =
      draftAmount(draft) && first
        ? lineField(first.lineId, "categoryId")
        : draft.inflow.trim()
          ? "inflow"
          : "outflow";
  };
  const afterSingleCategory = (categoryId: string) =>
    advance(
      categoryId === READY_TO_ASSIGN
        ? draftEntry?.fields.budgetSide === "other" && boundary
          ? "outflow"
          : "inflow"
        : draftEntry?.fields.budgetSide === "other" && boundary && draft.inflow
          ? "inflow"
          : "outflow",
    );
  const categoryControl = categoryNotNeeded ? (
    <TextInput
      value={
        draftEntry?.shape.kind === "card-payment"
          ? cardPaymentCategoryLabel(
              view.budget,
              draft.accountId,
              draft.transferAccountId,
            )
          : "Category not needed"
      }
      onChange={() => undefined}
      disabled
    />
  ) : (
    <NewCategoryPopover
      open={creating !== null}
      name={creating ?? ""}
      group={
        view.categories.find((item) => item.id === draft.categoryId)?.group
      }
      onOpenChange={(open) => {
        if (!open) setCreating(null);
      }}
      onAdded={(category) => {
        setAdded(category);
        setLost(null);
        chooseCategory(category.id);
      }}
      onSettled={(category, saved) => {
        if (!saved) setLost(category.id);
      }}
      onClosed={(category) => {
        if (category) afterCategory(category.id);
        else controls.current.categoryId?.focus({ preventScroll: true });
      }}
    >
      <div>
        <TransactionCategoryField
          amount={draftAmount(draft) ?? 0}
          share={draft.counterpartyShare}
          peopleEnabled={shareable && !split}
          value={split ? SPLIT : draft.categoryId}
          displayValue={split ? "Split" : undefined}
          action={
            splittable
              ? {
                  label: "Split",
                  icon: <SplitIcon size={13} strokeWidth={2.5} />,
                  onSelect: () => {
                    chooseCategory(SPLIT);
                    afterCategory(SPLIT);
                  },
                }
              : undefined
          }
          options={categoryOptions}
          placeholder="Category"
          inputRef={register("categoryId")}
          onChange={chooseCategory}
          onPicked={afterCategory}
          // A loan's payment takes a category that already exists.
          onCreate={
            loan ? undefined : { noun: "category", create: setCreating }
          }
        />
      </div>
    </NewCategoryPopover>
  );
  const accountControl = (
    <SearchList
      value={draft.accountId}
      options={accountOptions}
      placeholder="Account"
      inputRef={register("accountId")}
      disabled={editing}
      onChange={(accountId) =>
        entry.change({
          accountId,
          transferAccountId: "",
          loanId: "",
          payee: destination ? "" : draft.payee,
        })
      }
      onPicked={() => {
        if (!window.matchMedia("(pointer: fine)").matches) return;
        entry.setCalendarOpen(true);
        dateField.current?.focusCalendar();
      }}
    />
  );
  const notice = removed && (
    <p className={styles.notice} role="alert">
      This transaction was deleted in another session, so these changes can’t be
      saved. Cancel to close the editor.
    </p>
  );
  const error = session.error && (
    <p
      ref={register("error")}
      tabIndex={-1}
      className={styles.formError}
      role="status"
    >
      <CircleAlertIcon size={13} aria-hidden />
      {session.error}
    </p>
  );
  const actions = (
    <>
      <Button size="sm" onClick={entry.cancel}>
        Cancel
      </Button>
      {!editing && (
        <Button
          size="sm"
          disabled={removed}
          onClick={() => void entry.submit(true)}
        >
          Save and add another
        </Button>
      )}
      {matches.length ? (
        <Button
          size="sm"
          disabled={removed}
          onClick={() => entry.submit(false)}
        >
          Save as new
        </Button>
      ) : (
        <Button variant="primary" size="sm" type="submit" disabled={removed}>
          Save
        </Button>
      )}
    </>
  );

  // What the lines leave of the total: still to split, or split past it.
  const remainingLabel =
    remaining === undefined
      ? ""
      : remaining === 0 ||
          Math.sign(remaining) === Math.sign(draftAmount(draft) ?? 0)
        ? `Remaining ${money(Math.abs(remaining))}`
        : `Over by ${money(Math.abs(remaining))}`;
  // The columns before Category, empty on a split's rows.
  const leadingColumns = (
    <>
      {accountColumn && (
        <span className={styles.spacer} data-column="account" />
      )}
      <span className={styles.spacer} data-column="date" />
      <span className={styles.spacer} data-column="payee" />
    </>
  );
  // A split line: its category and amount under the row's own columns.
  const lineRow = (line: DraftLine, index: number) => {
    const number = index + 1;
    const lineId = (
      field: "categoryId" | "counterpartyShare" | "outflow" | "inflow",
    ) => lineField(line.lineId, field);
    const lineAmount = (name: "outflow" | "inflow") => (
      <AmountInput
        inputRef={register(lineId(name))}
        placeholder={name === "outflow" ? "Outflow" : "Inflow"}
        align="end"
        value={line[name]}
        onChange={(value) =>
          changeLine(line.lineId, amountChange(line, name, value))
        }
      />
    );
    return (
      <div
        key={line.lineId}
        className={`${shell.txColumns} ${styles.entryRow} ${styles.lineRow}`}
        data-accounts={accountColumn || undefined}
      >
        {leadingColumns}
        {cell(
          lineId("categoryId"),
          "category",
          `Line ${number} category`,
          <TransactionCategoryField
            amount={
              line.outflow.trim() || line.inflow.trim()
                ? (draftAmount(line) ?? 0)
                : (remaining ?? 0)
            }
            share={line.counterpartyShare}
            peopleEnabled={shareable}
            value={line.categoryId}
            options={spendingOptions}
            placeholder="Category"
            inputRef={register(lineId("categoryId"))}
            onChange={(categoryId, share) =>
              chooseLineCategory(line, categoryId, share)
            }
            onPicked={() => {
              if (!window.matchMedia("(pointer: fine)").matches) return;
              focusNext.current = lineAmountField(line);
            }}
          />,
        )}
        {shareCell(
          lineId("counterpartyShare"),
          `Line ${number} share`,
          line.counterpartyShare,
          draftAmount(line) ?? 0,
          session.initial?.lines?.find((item) => item.id === line.lineId)
            ?.counterpartyShare,
          (counterpartyShare) => changeLine(line.lineId, { counterpartyShare }),
        )}
        {cell(
          lineId("outflow"),
          "outflow",
          `Line ${number} outflow`,
          lineAmount("outflow"),
        )}
        {cell(
          lineId("inflow"),
          "inflow",
          `Line ${number} inflow`,
          lineAmount("inflow"),
        )}
        <div className={styles.removeLine} data-column="status">
          <IconButton
            label={`Remove line ${number}`}
            size="sm"
            onClick={() => removeLine(line.lineId)}
          >
            <XIcon aria-hidden />
          </IconButton>
        </div>
      </div>
    );
  };

  // A line's Share cell: a well that opens the share menu. saved is the
  // line's share as last saved, which "Just mine" writes off.
  const shareCell = (
    name: DraftField,
    label: string,
    value: DraftShare | null | undefined,
    lineAmount: number,
    saved: CounterpartyShare | undefined,
    onChange: (share: DraftShare | null) => void,
  ) => {
    const reading = value && readAmount(value.amount);
    const share = value && {
      ...value,
      amount: reading?.ok ? reading.cents : 0,
    };
    return (
      <EditorCell
        column="share"
        label={label}
        id={id(name)}
        error={fields[name]}
      >
        <ShareMenu
          amount={Math.abs(lineAmount)}
          share={share}
          saved={saved}
          remembered={name === "counterpartyShare" ? remembered : undefined}
          onChange={(next) => {
            onChange(
              next && { ...next, amount: (next.amount / 100).toFixed(2) },
            );
            return null;
          }}
        >
          <FieldButton ref={register(name)} placeholder="Just mine">
            {share?.amount ? <ShareLabel share={share} /> : undefined}
          </FieldButton>
        </ShareMenu>
      </EditorCell>
    );
  };

  const title = editing ? "Edit transaction" : "New transaction";
  return (
    <EditorForm
      id={formId}
      title={title}
      onSubmit={() => {
        // Enter matches an import to the one purchase it may be; with
        // several, the payer picks one.
        const [only] = matches;
        if (only && matches.length === 1) entry.matchImport(only);
        else if (matches.length)
          document
            .getElementById(formId)
            ?.querySelector<HTMLElement>("[data-partner-match]")
            ?.focus();
        else void entry.submit(false);
      }}
      onCancel={entry.cancel}
    >
      {notice}
      <div
        className={`${shell.txColumns} ${styles.entryRow}`}
        data-accounts={accountColumn || undefined}
      >
        {accountColumn &&
          cell("accountId", "account", "Account", accountControl)}
        {cell("date", "date", "Date", dateControl)}
        {cell("payee", "payee", "Payee", payeeControl)}
        {cell("categoryId", "category", "Category", categoryControl)}
        {split || !shareable ? (
          <span className={styles.spacer} data-column="share" />
        ) : (
          shareCell(
            "counterpartyShare",
            "Share",
            draft.counterpartyShare,
            draftAmount(draft) ?? 0,
            session.initial &&
              (session.initial.counterpartyShare ??
                (session.initial.lines?.length === 1
                  ? session.initial.lines[0]!.counterpartyShare
                  : undefined)),
            (counterpartyShare) => entry.change({ counterpartyShare }),
          )
        )}
        {cell("outflow", "outflow", "Outflow", amount("outflow"))}
        {cell("inflow", "inflow", "Inflow", amount("inflow"))}
        {session.initial?.reconciled ? (
          <span data-column="status" aria-hidden />
        ) : (
          <div className={styles.removeLine} data-column="status">
            <IconButton
              label={draft.cleared ? "Mark uncleared" : "Mark cleared"}
              size="sm"
              onClick={() => entry.change({ cleared: !draft.cleared })}
            >
              <ClearedMark state={clearedState(draft)} labeled={false} />
            </IconButton>
          </div>
        )}
        {amountError && (
          <p id={amountErrorId} className={styles.amountError}>
            <CircleAlertIcon size={13} aria-hidden />
            {amountError}
          </p>
        )}
      </div>
      {split && (
        <div role="group" aria-label="Split" className={styles.lines}>
          {draft.lines.map((line, index) => lineRow(line, index))}
          <div
            className={`${shell.txColumns} ${styles.splitFooter}`}
            data-accounts={accountColumn || undefined}
          >
            {leadingColumns}
            <div data-column="category">
              <Button
                ref={register("addLine")}
                variant="quiet"
                size="sm"
                onClick={addLine}
              >
                <PlusIcon aria-hidden />
                Add line
              </Button>
            </div>
            <div
              ref={register("remaining")}
              tabIndex={-1}
              className={styles.remaining}
              data-unsplit={remaining ? "" : undefined}
              aria-live="polite"
            >
              <p>{remainingLabel}</p>
              {fields.remaining && (
                <p
                  id={`${formId}-remaining-error`}
                  className={styles.formError}
                >
                  <CircleAlertIcon size={13} aria-hidden />
                  {fields.remaining}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
      {loan && (
        <div className={styles.loanDetails}>
          <Field label="Lender-confirmed interest" error={fields.interest}>
            <AmountInput
              inputRef={register("interest")}
              value={draft.interest}
              placeholder="0.00"
              onChange={(interest) => entry.change({ interest })}
            />
          </Field>
          <p>
            The outflow includes principal and interest. Only principal reduces
            the loan balance.
          </p>
        </div>
      )}
      {matches.length > 0 && <PartnerMatches matches={matches} />}
      <EditorFooter actions={actions}>
        {remembered && (
          <span className={shareStyles.footerHint}>
            Category and share filled in from {remembered} last time
          </span>
        )}
        {error}
      </EditorFooter>
    </EditorForm>
  );
}
