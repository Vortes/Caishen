"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { sameAmount } from "~/components/budget/amount";
import { newId } from "~/components/budget/format";
import type { Command } from "~/domain/engine";
import { AmountInput } from "~/components/ui/amount-input";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { DateField } from "~/components/ui/date-field";
import { Field, FormError } from "~/components/ui/field";
import { FieldButton } from "~/components/ui/field-button";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "~/components/ui/segmented-control";
import { Menu, MenuRadioGroup, MenuRadioItem } from "~/components/ui/menu";
import { Select } from "~/components/ui/select";
import { TextInput } from "~/components/ui/text-input";
import type { Category } from "./model";
import { useShellData } from "./shell-data";
import {
  activeBehavior,
  amountLabel,
  behaviorCopy,
  behaviorLabel,
  behaviorsFor,
  buildTarget,
  createTargetDraft,
  draftAmount,
  earliestDueMonth,
  ordinal,
  schedules,
  weekdays,
  type Behavior,
  type Schedule,
  type TargetDraft,
  type TargetField,
} from "./target-draft";
import styles from "./target-editor.module.css";

export type TargetEditing = {
  // Sends the target's command with a summary for its confirmation. Returns
  // why it can't be sent right now, or null once it's on its way.
  save: (command: Command, summary: string) => string | null;
  // Called with a cleanup while the editor is open, so the shell can hold
  // its undo shortcut until it closes.
  holdOpen: () => () => void;
};

const TargetEditingContext = createContext<TargetEditing | null>(null);

export const TargetEditingProvider = TargetEditingContext.Provider;

export function useTargetEditing() {
  const value = useContext(TargetEditingContext);
  if (!value)
    throw new Error("useTargetEditing needs a TargetEditingProvider.");
  return value;
}

type EditorError = { field: TargetField | "form"; message: string };

// YNAB's target editor, in place of the target's summary in the inspector.
// The schedule decides which fields follow; a custom schedule asks what to
// do before when, the others when before what to do next time.
export function TargetEditor({
  category,
  onClose,
}: {
  category: Category;
  onClose: () => void;
}) {
  const { month, today } = useShellData();
  const { save, holdOpen } = useTargetEditing();
  useEffect(() => holdOpen(), [holdOpen]);
  const kind = category.pays?.type ?? "spending";
  const existing = category.rule;
  const [draft, setDraft] = useState<TargetDraft>(() =>
    createTargetDraft(kind, month.key, existing),
  );
  const [error, setError] = useState<EditorError | null>(null);
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const fieldRefs = useRef<Partial<Record<TargetField, HTMLElement | null>>>(
    {},
  );
  const register = (field: TargetField) => (element: HTMLElement | null) => {
    fieldRefs.current[field] = element;
  };

  // Focus starts in the first field, the amount where there is one, as it
  // does after clicking Create target in YNAB.
  useEffect(() => {
    const fields = fieldRefs.current;
    (fields.amount ?? fields.dueDate)?.focus({ preventScroll: true });
  }, []);

  const change = (changes: Partial<TargetDraft>) => {
    setDraft((value) => ({ ...value, ...changes }));
    setError(null);
  };
  const behavior = activeBehavior(draft);
  const behaviors = behaviorsFor(draft.schedule);
  const amount = draftAmount(draft.amount) ?? 0;
  const schedule = draft.schedule;
  const payoff = schedule === "card-payoff" || schedule === "loan-payoff";
  const custom = schedule === "custom";
  const balance = behavior === "balance";
  const datedSchedule = schedule === "yearly" || custom || payoff;
  const earliest = earliestDueMonth(draft, { month: month.key, existing });
  const fieldId = (field: string) => `${id}-${field}`;
  const errorFor = (field: TargetField) =>
    error?.field === field ? error.message : undefined;

  const send = (command: Command, summary: string) => {
    const blocked = save(command, summary);
    if (blocked) setError({ field: "form", message: blocked });
    else onClose();
  };
  const submit = () => {
    const result = buildTarget(draft, { month: month.key, existing });
    if (!result.ok) {
      setError({ field: result.field, message: result.message });
      fieldRefs.current[result.field]?.focus();
      return;
    }
    send(
      {
        type: "target.set",
        id: newId(),
        categoryId: category.id,
        target: result.target,
      },
      existing
        ? `Updated the ${category.name} target`
        : `Added a target to ${category.name}`,
    );
  };
  const remove = () =>
    send(
      {
        type: "target.set",
        id: newId(),
        categoryId: category.id,
        target: null,
      },
      `Deleted the ${category.name} target`,
    );

  const amountField = !payoff && (
    <Field label={amountLabel(schedule)} error={errorFor("amount")}>
      <AmountInput
        inputRef={register("amount")}
        placeholder="0.00"
        value={draft.amount}
        onChange={(next) =>
          // Leaving the field rewrites it as its result; its error stays.
          sameAmount(draft.amount, next)
            ? setDraft((value) => ({ ...value, amount: next }))
            : change({ amount: next })
        }
      />
    </Field>
  );

  const behaviorField = behaviors.length > 0 && (
    <BehaviorField
      label={behaviorLabel(schedule)}
      behaviors={behaviors}
      value={behavior}
      schedule={schedule}
      amount={amount}
      onChange={(next) => change({ behavior: next })}
    />
  );

  const payoffHint = !payoff
    ? undefined
    : kind === "card"
      ? "Sets aside enough each month to pay the card’s balance in full by this date."
      : "Works out the monthly payment that clears the loan by this date, at its current rate.";
  const dueDateField = datedSchedule && !balance && (
    <Field
      label={payoff ? "Pay off by" : custom ? "Due on" : "By"}
      error={errorFor("dueDate")}
      hint={payoffHint}
    >
      <DateField
        value={draft.dueDate}
        min={`${earliest}-01`}
        today={today}
        inputRef={register("dueDate")}
        onChange={(dueDate) => change({ dueDate })}
      />
    </Field>
  );

  return (
    <form
      ref={formRef}
      className={styles.form}
      noValidate
      aria-label={`${existing ? "Edit" : "Create"} target for ${category.name}`}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={(event) => {
        // Escape from a field cancels; menus and the calendar portal out of
        // the form and close themselves first.
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          formRef.current?.contains(event.target as Node)
        ) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <SegmentedControl
        fill
        aria-label="Schedule"
        value={schedule}
        onValueChange={(next) => change({ schedule: next as Schedule })}
      >
        {schedules[kind].map((item) => (
          <SegmentedControlItem key={item.value} value={item.value}>
            {item.label}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>

      {amountField}

      {schedule === "weekly" && (
        <Field id={fieldId("weekday")} label="Every">
          <Select
            value={String(draft.weekday)}
            onChange={(value) => change({ weekday: Number(value) })}
            options={weekdays.map((day, index) => ({
              value: String(index),
              label: day,
            }))}
          />
        </Field>
      )}

      {schedule === "monthly" && (
        <Field id={fieldId("monthDay")} label="By">
          <Select
            value={String(draft.monthDay)}
            onChange={(value) =>
              change({ monthDay: value === "last" ? "last" : Number(value) })
            }
            options={[
              { value: "last", label: "Last day of the month" },
              ...Array.from({ length: 31 }, (_, index) => ({
                value: String(index + 1),
                label: `The ${ordinal(index + 1)}`,
              })),
            ]}
          />
        </Field>
      )}

      {custom ? (
        <>
          {behaviorField}
          {dueDateField}
          {balance ? (
            <BalanceDue
              id={fieldId("dueMonth")}
              draft={draft}
              start={earliest}
              error={errorFor("dueMonth")}
              register={register("dueMonth")}
              onChange={change}
            />
          ) : (
            <Repeat
              draft={draft}
              error={errorFor("repeatEvery")}
              register={register("repeatEvery")}
              onChange={change}
            />
          )}
        </>
      ) : (
        <>
          {dueDateField}
          {behaviorField}
        </>
      )}

      {error?.field === "form" && <FormError>{error.message}</FormError>}

      <div className={styles.footer}>
        {existing && (
          <Button size="sm" onClick={remove}>
            Delete target
          </Button>
        )}
        <span className={styles.spacer} />
        <Button size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" type="submit">
          Save target
        </Button>
      </div>
    </form>
  );
}

// Custom targets can come due again: every so many months or years after
// the due date.
function Repeat({
  draft,
  error,
  register,
  onChange,
}: {
  draft: TargetDraft;
  error?: string;
  register: (element: HTMLElement | null) => void;
  onChange: (changes: Partial<TargetDraft>) => void;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.check}>
        <Checkbox
          checked={draft.repeat}
          onCheckedChange={(value) => onChange({ repeat: value === true })}
        />
        Repeat
      </label>
      {draft.repeat && (
        <Field label="Every" error={error}>
          <div className={styles.inline}>
            <div className={styles.every}>
              <TextInput
                inputRef={register}
                inputMode="numeric"
                value={draft.repeatEvery}
                onChange={(repeatEvery) => onChange({ repeatEvery })}
              />
            </div>
            <div className={styles.unit}>
              <Field label="Repeat unit" labelHidden>
                <Select
                  value={draft.repeatUnit}
                  onChange={(value) =>
                    onChange({
                      repeatUnit: value as TargetDraft["repeatUnit"],
                    })
                  }
                  options={[
                    {
                      value: "months",
                      label:
                        draft.repeatEvery.trim() === "1" ? "Month" : "Months",
                    },
                    {
                      value: "years",
                      label:
                        draft.repeatEvery.trim() === "1" ? "Year" : "Years",
                    },
                  ]}
                />
              </Field>
            </div>
          </div>
        </Field>
      )}
    </div>
  );
}

// A balance goal can be reached whenever, or by a month.
function BalanceDue({
  id,
  draft,
  start,
  error,
  register,
  onChange,
}: {
  id: string;
  draft: TargetDraft;
  start: string;
  error?: string;
  register: (element: HTMLElement | null) => void;
  onChange: (changes: Partial<TargetDraft>) => void;
}) {
  const [year, monthIndex] = draft.dueMonth.split("-");
  // A saved goal due before the earliest month still shows its own year.
  const firstYear = Math.min(Number(start.slice(0, 4)), Number(year));
  const years = Array.from({ length: 31 }, (_, index) => firstYear + index);
  const months = Array.from({ length: 12 }, (_, index) =>
    new Date(2000, index, 15).toLocaleDateString("en-US", { month: "long" }),
  );
  return (
    <div className={styles.field}>
      <label className={styles.check}>
        <Checkbox
          checked={draft.balanceDue}
          onCheckedChange={(value) => onChange({ balanceDue: value === true })}
        />
        Due by date
      </label>
      {draft.balanceDue && (
        <Field id={id} label="Due on" error={error}>
          <div className={styles.inline}>
            <div className={styles.grow}>
              <Select
                inputRef={register}
                value={monthIndex!}
                onChange={(value) => onChange({ dueMonth: `${year}-${value}` })}
                options={months.map((name, index) => ({
                  value: String(index + 1).padStart(2, "0"),
                  label: name,
                }))}
              />
            </div>
            <div className={styles.year}>
              <Field
                label="Due year"
                labelHidden
                sharedErrorId={error ? `${id}-error` : undefined}
              >
                <Select
                  value={year!}
                  onChange={(value) =>
                    onChange({ dueMonth: `${value}-${monthIndex}` })
                  }
                  options={years.map((value) => ({
                    value: String(value),
                    label: String(value),
                  }))}
                />
              </Field>
            </div>
          </div>
        </Field>
      )}
    </div>
  );
}

// What happens once the target is met, in YNAB's words: a menu of the
// behaviors this schedule offers, each with what it's for.
function BehaviorField({
  label,
  behaviors,
  value,
  schedule,
  amount,
  onChange,
}: {
  label: string;
  behaviors: Behavior[];
  value: Behavior;
  schedule: Schedule;
  amount: number;
  onChange: (behavior: Behavior) => void;
}) {
  const chosen = behaviorCopy(value, schedule, amount);
  return (
    <Field label={label}>
      {/* Escape closes only the menu; the editor around it stays open. */}
      <Menu
        label={label}
        trigger={<FieldButton chevron>{chosen.title}</FieldButton>}
      >
        <MenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as Behavior)}
        >
          {behaviors.map((behavior) => {
            const copy = behaviorCopy(behavior, schedule, amount);
            return (
              <MenuRadioItem
                key={behavior}
                value={behavior}
                title={copy.title}
                tag={
                  copy.common && behaviors.length > 1
                    ? "Most common"
                    : undefined
                }
                detail={[`Use for: ${copy.use}`, copy.detail]}
              />
            );
          })}
        </MenuRadioGroup>
      </Menu>
    </Field>
  );
}
