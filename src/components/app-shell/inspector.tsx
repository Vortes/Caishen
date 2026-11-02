"use client";

import {
  CalendarDaysIcon,
  CreditCardIcon,
  FolderIcon,
  LandmarkIcon,
  TargetIcon,
  ChartNoAxesCombinedIcon,
  UsersIcon,
  ZapIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { optionAmount, type AutoAssignOption } from "~/domain/auto-assign";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { newId } from "~/components/budget/format";
import { Card } from "~/components/ui/card";
import { FormError } from "~/components/ui/field";
import { FoldProvider, Figure, Property, Section } from "./cards";
import { useAutoAssign } from "./assign-money";
import { money, type Category } from "./model";
import { ExpectedIncomeProperty } from "./expected-income";
import { MoveMoneyPopover } from "./move-money";
import { RtaCard } from "./ready-to-assign";
import { useShellData } from "./shell-data";
import { TargetEditor, useTargetEditing } from "./target-editor";
import type { Screen } from "~/components/workspace/routes";
import { viewOf, type PlanView as PlanViewId } from "./plan-views";
import { FundingRing } from "./views";
import { ActivityProperty, type ActivityJump } from "./activity";
import styles from "./shell.module.css";

export function Inspector(props: Parameters<typeof InspectorCards>[0]) {
  return (
    <FoldProvider>
      <InspectorCards {...props} />
    </FoldProvider>
  );
}

function InspectorCards({
  screen,
  selectedId,
  checked,
  view,
  onJump,
}: {
  screen: Screen;
  selectedId: string | null;
  checked: string[];
  view: PlanViewId | null;
  onJump: ActivityJump;
}) {
  const { categories, loans, readyToAssign } = useShellData();
  if (screen.type === "plan") {
    // The plan's selection is its checked rows: one shows that category,
    // several show their combined details, and every category the plan
    // shows leaves only Auto-Assign over them.
    const category =
      checked.length === 1
        ? categories.find((item) => item.id === checked[0])
        : undefined;
    const showing = view ? categories.filter(viewOf(view).matches) : categories;
    const everything =
      showing.length > 1 && showing.every((item) => checked.includes(item.id));
    return (
      <>
        <RtaCard amount={readyToAssign} />
        {everything ? (
          <AutoAssign
            scope={categories.filter((item) => checked.includes(item.id))}
          />
        ) : checked.length > 1 ? (
          <CheckedDetails ids={checked} />
        ) : category ? (
          <CategoryDetails
            key={category.id}
            category={category}
            onJump={onJump}
          />
        ) : (
          <MonthDetails />
        )}
      </>
    );
  }
  // An account's register has no details panel; its island and balance
  // strip take its place.
  if (screen.type === "register") return null;
  const loan = loans.find((item) => item.id === selectedId);
  if (!loan) {
    return (
      <>
        <Section
          id="loans"
          icon={<LoanIcon />}
          title="Loans"
          subtitle={
            loans.length
              ? "Nothing selected. Pick a loan to see its payoff."
              : "No loans yet."
          }
        >
          <Figure
            value={money(-loans.reduce((sum, item) => sum + item.balance, 0))}
            caption="Total remaining"
          />
        </Section>
        <Card>
          <Property label="Monthly">
            {money(loans.reduce((sum, item) => sum + item.payment, 0))}
          </Property>
          <Property label="Funded">
            {money(loans.reduce((sum, item) => sum + item.funded, 0))}
          </Property>
        </Card>
      </>
    );
  }
  return (
    <>
      <Section id="loan" icon={<LoanIcon />} title={loan.name}>
        <Figure value={money(-loan.balance)} caption="Remaining balance" />
      </Section>
      <Card>
        <Property label="Rate">
          {loan.rate ?? <span className={styles.faint}>No rate yet</span>}
          {loan.variable && <span className={styles.faint}>Variable</span>}
        </Property>
        <Property label="Payment">{money(loan.payment)} monthly</Property>
        <Property label="Funded">{money(loan.funded)} this month</Property>
        <Property label="Payoff" icon={CalendarDaysIcon}>
          {loan.payoff}
        </Property>
      </Card>
      <Card>
        <Property label="Interest">
          {loan.interest === null
            ? "Unknown"
            : `${money(loan.interest)} left to pay`}
        </Property>
        <Property label="Borrowed">{money(loan.principal)}</Property>
        <Property label="Payments">{loan.payments} recorded</Property>
      </Card>
    </>
  );
}

function LoanIcon() {
  return (
    <ChartNoAxesCombinedIcon
      size={15}
      className={styles.titleIcon}
      aria-hidden
    />
  );
}

export const autoAssignOptions: [AutoAssignOption, string][] = [
  ["underfunded", "Underfunded"],
  ["assigned-last-month", "Assigned last month"],
  ["spent-last-month", "Spent last month"],
  ["average-assigned", "Average assigned"],
  ["average-spent", "Average spent"],
  ["reduce-overfunding", "Reduce overfunding"],
];

// Runs an option over the inspected categories: the whole month, a
// selection, or one category. It always stands in its own card.
function AutoAssign({ scope }: { scope: Category[] }) {
  const [error, setError] = useState<string | null>(null);
  const { scope: categories, plan, run } = useAutoAssign(scope);
  return (
    <Section id="auto-assign" title="Auto-Assign">
      <ul className={styles.actionList}>
        {autoAssignOptions.map(([option, label]) => (
          <li key={option}>
            <button
              type="button"
              className={styles.actionItem}
              disabled={plan(option).changes.length === 0}
              onClick={() => setError(run(option))}
            >
              <ZapIcon size={13} aria-hidden />
              <span>{label}</span>
              <span className={styles.numeric}>
                {money(optionAmount(option, categories))}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <div className={styles.autoAssignError}>
          <FormError>{error}</FormError>
        </div>
      )}
    </Section>
  );
}

function sum(categories: Category[], pick: (item: Category) => number) {
  return categories.reduce((total, item) => total + pick(item), 0);
}

// YNAB's month summary: how the month's money adds up, then Cost to Be Me,
// what the month's targets ask for against the income you expect.
function MonthDetails() {
  const { categories, month, costToBeMe, expectedIncome } = useShellData();
  return (
    <>
      <Section id="summary" title={`${month.short}'s summary`}>
        <Property label="Last month">
          {money(sum(categories, (item) => item.carryover))}
        </Property>
        <Property label="Assigned">
          {money(sum(categories, (item) => item.assigned))}
        </Property>
        <Property label="Activity">
          {money(sum(categories, (item) => item.activity))}
        </Property>
        <Property label="Available">
          {money(sum(categories, (item) => item.available))}
        </Property>
        <div className={styles.cardSection}>
          <h3 className={styles.cardSectionTitle}>Cost to Be Me</h3>
          <Property label="Targets">{money(costToBeMe)}</Property>
          <Property label="Income">
            <ExpectedIncomeProperty />
          </Property>
          {expectedIncome !== null && (
            <Meter
              ratio={costToBeMe ? Math.min(1, expectedIncome / costToBeMe) : 1}
              tone={expectedIncome < costToBeMe ? "underfunded" : "funded"}
              label={
                expectedIncome < costToBeMe
                  ? `${money(costToBeMe - expectedIncome)} short of ${month.short}'s targets`
                  : `${money(expectedIncome - costToBeMe)} left after ${month.short}'s targets`
              }
            />
          )}
        </div>
      </Section>
      <AutoAssign scope={categories} />
    </>
  );
}

function CheckedDetails({ ids }: { ids: string[] }) {
  const categories = useShellData().categories.filter((item) =>
    ids.includes(item.id),
  );
  const overspent = categories.filter((item) => item.available < 0);
  return (
    <>
      <Section
        id="selection"
        title={`${categories.length} ${categories.length === 1 ? "category" : "categories"} selected`}
        subtitle={categories.map((item) => item.name).join(", ")}
      >
        <Figure
          value={money(sum(categories, (item) => item.available))}
          caption={
            overspent.length
              ? `Available, with ${overspent.length} overspent`
              : "Available across the selection"
          }
          tone={overspent.length ? "overspent" : undefined}
        />
      </Section>
      <Card>
        <Property label="Assigned">
          {money(sum(categories, (item) => item.assigned))}
        </Property>
        <Property label="Activity">
          {money(sum(categories, (item) => item.activity))}
        </Property>
        <Property label="Last month">
          {money(sum(categories, (item) => item.carryover))}
        </Property>
      </Card>
      <AutoAssign scope={categories} />
    </>
  );
}

function CategoryDetails({
  category,
  onJump,
}: {
  category: Category;
  onJump: ActivityJump;
}) {
  const fallback =
    category.available > 0 ? "Money available" : "No money assigned yet";
  return (
    <>
      <Section
        id="category"
        icon={<FundingRing category={category} size={15} />}
        title={category.name}
        subtitle={category.group}
      >
        <Figure
          value={money(category.available)}
          caption={category.status || fallback}
          tone={category.funding}
        />
        <div className={styles.cardActions}>
          <MoveMoneyPopover category={category} align="start">
            {category.available < 0 ? (
              <Button variant="primary">Cover overspending</Button>
            ) : (
              <Button>Move money</Button>
            )}
          </MoveMoneyPopover>
        </div>
      </Section>
      {category.pairs && <PairedBalance category={category} />}
      <Card>
        <Property label="Assigned">{money(category.assigned)}</Property>
        <Property label="Activity">
          <ActivityProperty category={category} onJump={onJump} />
        </Property>
        <Property label="Last month">{money(category.carryover)}</Property>
        <Property label="Group" icon={FolderIcon}>
          {category.group}
        </Property>
        {category.pairs && (
          <Property label="Account" icon={UsersIcon}>
            {category.pairs.name}
          </Property>
        )}
        {category.pays && (
          <Property
            label="Pays"
            icon={category.pays.type === "card" ? CreditCardIcon : LandmarkIcon}
          >
            {category.pays.name}
          </Property>
        )}
      </Card>
      <Section id="target" title="Target">
        <TargetTab category={category} />
      </Section>
      <AutoAssign scope={[category]} />
    </>
  );
}

// A paired envelope's money, as one subtraction: the float set aside, less
// what its account says is owed to you, is what it has available.
function PairedBalance({ category }: { category: Category }) {
  const balance = category.pairs!.balance;
  const float = category.available + balance;
  return (
    <Card>
      <Property label="Float">{money(float)}</Property>
      {balance >= 0 ? (
        <Property label="Owed to you">{money(-balance || 0)}</Property>
      ) : (
        <Property label="You owe">+{money(-balance)}</Property>
      )}
      <Property label="Available">{money(category.available)}</Property>
    </Card>
  );
}

const focusable = "button, input, select, textarea, a[href], [tabindex='0']";

// The category's target: what it asks for and how far along it is, or the
// way to set one. Editing happens in place, as in YNAB.
function TargetTab({ category }: { category: Category }) {
  const [editing, setEditing] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const returning = useRef(false);
  const hasTarget = Boolean(category.rule);
  // Focus goes back to Create target or Edit target once the editor closes,
  // and follows when the saved change swaps one for the other, until it's
  // moved somewhere else.
  useEffect(() => {
    if (editing) {
      returning.current = true;
      return;
    }
    if (!returning.current) return;
    const active = document.activeElement;
    if (active && active !== opener.current && active.closest(focusable))
      returning.current = false;
    else opener.current?.focus({ preventScroll: true });
  }, [editing, hasTarget]);
  const { month } = useShellData();
  const target = category.target;
  if (editing)
    return (
      <TargetEditor category={category} onClose={() => setEditing(false)} />
    );
  if (!category.rule || !target)
    return (
      <div className={styles.tabEmpty}>
        <strong className={styles.tabEmptyTitle}>
          {category.pays
            ? `How much do you want to pay toward ${category.pays.name}?`
            : `How much do you need for ${category.name}?`}
        </strong>
        <p>
          Set a target and Caishen works out how much to set aside each month to
          stay on track.
        </p>
        <Button ref={opener} variant="quiet" onClick={() => setEditing(true)}>
          Create target
        </Button>
      </div>
    );
  return (
    <div className={styles.tabBody}>
      <Property label="Goal" icon={TargetIcon}>
        {target.action}
      </Property>
      <Property label="Due">{target.when}</Property>
      <Property label="Funded">
        {money(target.funded)} of {money(target.total)}
      </Property>
      <Meter
        ratio={category.fundedRatio}
        tone={category.funding}
        label={
          category.funding === "snoozed"
            ? `Snoozed for ${month.short}`
            : target.needed > 0
              ? `${money(target.needed)} more needed`
              : `${Math.round(category.fundedRatio * 100)}% funded`
        }
      />
      <TargetSnooze key={`${category.id}:${month.key}`} category={category} />
      <div className={styles.tabActions}>
        <Button ref={opener} variant="quiet" onClick={() => setEditing(true)}>
          Edit target
        </Button>
      </div>
    </div>
  );
}

function TargetSnooze({ category }: { category: Category }) {
  const { month, today } = useShellData();
  const { save } = useTargetEditing();
  const [error, setError] = useState<string | null>(null);
  const current = month.key === today.slice(0, 7);
  const snoozed = category.rule?.snoozedMonths.includes(month.key) ?? false;
  if (category.pays?.type === "card" || category.pairs) return null;
  return (
    <>
      <label className={styles.snoozeRow} data-disabled={!current || undefined}>
        <span className={styles.snoozeLabel}>
          {snoozed && !current ? "Snoozed in" : "Snooze for"} {month.short}
        </span>
        <Switch
          checked={snoozed}
          disabled={!current}
          onCheckedChange={(on) =>
            setError(
              save(
                {
                  type: "target.snooze",
                  id: newId(),
                  categoryId: category.id,
                  month: month.key,
                  currentMonth: today.slice(0, 7),
                  snoozed: on,
                },
                on
                  ? `Snoozed the ${category.name} target for ${month.short}`
                  : `Resumed the ${category.name} target`,
              ),
            )
          }
        />
      </label>
      {error && <FormError>{error}</FormError>}
    </>
  );
}

function Meter({
  ratio,
  label,
  tone,
}: {
  ratio: number;
  label: string;
  tone?: string;
}) {
  return (
    <div className={styles.meter} data-state={tone}>
      <span className={styles.meterTrack}>
        <span style={{ transform: `scaleX(${ratio})` }} />
      </span>
      <span>{label}</span>
    </div>
  );
}
