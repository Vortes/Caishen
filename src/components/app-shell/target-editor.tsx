"use client";

import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { newId } from "~/components/budget/format";
import type { Command } from "~/domain/engine";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "~/components/ui/segmented-control";
import { Tag } from "~/components/ui/tag";
import { usePortalContainer } from "~/components/ui/tooltip";
import type { Category } from "./model";
import { FieldError } from "./move-money";
import { useShellData } from "./shell-data";
import { DateField } from "./transaction-date";
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
// The transaction editor's field wells, so every field in the shell matches.
import entry from "./transaction-entry.module.css";
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

type FormError = { field: TargetField | "form"; message: string };

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
  const [error, setError] = useState<FormError | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
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
  const describedBy = (field: TargetField) =>
    error?.field === field ? fieldId(`${field}-error`) : undefined;

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

  // Leaving the date's calendar with Tab moves on to the next field.
  const advanceFrom = (element: HTMLElement | null | undefined) => {
    const stops = [
      ...(formRef.current?.querySelectorAll<HTMLElement>(
        "input, select, button:not([tabindex='-1'])",
      ) ?? []),
    ].filter((stop) => !stop.hasAttribute("disabled"));
    const index = element ? stops.indexOf(element) : -1;
    stops[index + 1]?.focus();
  };

  const amountField = !payoff && (
    <Field
      id={fieldId("amount")}
      label={amountLabel(schedule)}
      error={errorFor("amount")}
    >
      <div
        className={entry.well}
        data-invalid={error?.field === "amount" || undefined}
      >
        <span className={styles.prefix} aria-hidden>
          $
        </span>
        <input
          ref={register("amount")}
          id={fieldId("amount")}
          className={entry.input}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={draft.amount}
          aria-invalid={error?.field === "amount" || undefined}
          aria-describedby={describedBy("amount")}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => change({ amount: event.target.value })}
        />
      </div>
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
      id={fieldId("dueDate")}
      label={payoff ? "Pay off by" : custom ? "Due on" : "By"}
      error={errorFor("dueDate")}
      hint={payoffHint}
    >
      <DateField
        id={fieldId("dueDate")}
        label={payoff ? "Pay off by" : "Due date"}
        value={draft.dueDate}
        min={`${earliest}-01`}
        today={today}
        open={calendarOpen}
        invalid={error?.field === "dueDate"}
        describedBy={
          [describedBy("dueDate"), payoffHint && fieldId("dueDate-hint")]
            .filter(Boolean)
            .join(" ") || undefined
        }
        inputRef={register("dueDate")}
        onOpenChange={setCalendarOpen}
        onChange={(dueDate) => change({ dueDate })}
        onPicked={() => undefined}
        onAdvance={() => advanceFrom(fieldRefs.current.dueDate)}
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
            id={fieldId("weekday")}
            value={String(draft.weekday)}
            onChange={(value) => change({ weekday: Number(value) })}
          >
            {weekdays.map((day, index) => (
              <option key={day} value={index}>
                {day}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {schedule === "monthly" && (
        <Field id={fieldId("monthDay")} label="By">
          <Select
            id={fieldId("monthDay")}
            value={String(draft.monthDay)}
            onChange={(value) =>
              change({ monthDay: value === "last" ? "last" : Number(value) })
            }
          >
            <option value="last">Last day of the month</option>
            {Array.from({ length: 31 }, (_, index) => (
              <option key={index} value={index + 1}>
                The {ordinal(index + 1)}
              </option>
            ))}
          </Select>
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
              id={fieldId("repeatEvery")}
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

      {error?.field === "form" && (
        <FieldError id={fieldId("form-error")} message={error.message} />
      )}

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

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  // What the field means, below it; the control names it in
  // aria-describedby as `${id}-hint`.
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error && <FieldError id={`${id}-error`} message={error} />}
      {hint && (
        <p className={styles.hint} id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

// A native select in the shell's field well. A select primitive isn't in
// the design system yet.
function Select({
  id,
  value,
  label,
  invalid,
  describedBy,
  selectRef,
  onChange,
  children,
}: {
  id?: string;
  value: string;
  label?: string;
  invalid?: boolean;
  describedBy?: string;
  selectRef?: (element: HTMLElement | null) => void;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className={entry.well} data-invalid={invalid ? true : undefined}>
      <select
        ref={selectRef}
        id={id}
        className={`${entry.input} ${styles.select}`}
        value={value}
        aria-label={label}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
      <ChevronDownIcon size={14} className={styles.chevron} aria-hidden />
    </div>
  );
}

// Custom targets can come due again: every so many months or years after
// the due date.
function Repeat({
  id,
  draft,
  error,
  register,
  onChange,
}: {
  id: string;
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
        <div className={styles.inline}>
          <label htmlFor={id}>Every</label>
          <div
            className={`${entry.well} ${styles.every}`}
            data-invalid={error ? true : undefined}
          >
            <input
              ref={register}
              id={id}
              className={entry.input}
              inputMode="numeric"
              autoComplete="off"
              value={draft.repeatEvery}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) =>
                onChange({ repeatEvery: event.target.value })
              }
            />
          </div>
          <div className={styles.unit}>
            <Select
              label="Repeat unit"
              value={draft.repeatUnit}
              onChange={(value) =>
                onChange({ repeatUnit: value as TargetDraft["repeatUnit"] })
              }
            >
              <option value="months">
                {draft.repeatEvery.trim() === "1" ? "Month" : "Months"}
              </option>
              <option value="years">
                {draft.repeatEvery.trim() === "1" ? "Year" : "Years"}
              </option>
            </Select>
          </div>
        </div>
      )}
      {error && <FieldError id={`${id}-error`} message={error} />}
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
        <div className={styles.field}>
          <label htmlFor={id}>Due on</label>
          <div className={styles.inline}>
            <div className={styles.grow}>
              <Select
                id={id}
                selectRef={register}
                value={monthIndex!}
                invalid={Boolean(error)}
                describedBy={error ? `${id}-error` : undefined}
                onChange={(value) => onChange({ dueMonth: `${year}-${value}` })}
              >
                {months.map((name, index) => (
                  <option key={name} value={String(index + 1).padStart(2, "0")}>
                    {name}
                  </option>
                ))}
              </Select>
            </div>
            <div className={styles.year}>
              <Select
                label="Due year"
                value={year!}
                invalid={Boolean(error)}
                onChange={(value) =>
                  onChange({ dueMonth: `${value}-${monthIndex}` })
                }
              >
                {years.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </div>
      )}
      {error && <FieldError id={`${id}-error`} message={error} />}
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
  const container = usePortalContainer();
  const id = useId();
  const chosen = behaviorCopy(value, schedule, amount);
  return (
    <div className={styles.field}>
      <span className={styles.label} id={`${id}-label`}>
        {label}
      </span>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger
          className={`${entry.well} ${styles.trigger}`}
          aria-labelledby={`${id}-label ${id}-value`}
        >
          <span id={`${id}-value`} className={styles.triggerValue}>
            {chosen.title}
          </span>
          <ChevronDownIcon size={14} className={styles.chevron} aria-hidden />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal container={container}>
          <DropdownMenu.Content
            className={styles.menu}
            align="start"
            sideOffset={4}
            collisionPadding={12}
            aria-label={label}
            // Escape closes only the menu; the editor around it stays open.
            onEscapeKeyDown={(event) => event.stopPropagation()}
          >
            <DropdownMenu.RadioGroup
              value={value}
              onValueChange={(next) => onChange(next as Behavior)}
            >
              {behaviors.map((behavior) => {
                const copy = behaviorCopy(behavior, schedule, amount);
                return (
                  <DropdownMenu.RadioItem
                    key={behavior}
                    value={behavior}
                    className={styles.option}
                  >
                    <span className={styles.optionCheck}>
                      <DropdownMenu.ItemIndicator>
                        <CheckIcon size={13} strokeWidth={2.5} aria-hidden />
                      </DropdownMenu.ItemIndicator>
                    </span>
                    <span className={styles.optionText}>
                      <span className={styles.optionTitle}>
                        {copy.title}
                        {copy.common && behaviors.length > 1 && (
                          <Tag>Most common</Tag>
                        )}
                      </span>
                      <span className={styles.optionUse}>
                        Use for: {copy.use}
                      </span>
                      <span className={styles.optionDetail}>{copy.detail}</span>
                    </span>
                  </DropdownMenu.RadioItem>
                );
              })}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
