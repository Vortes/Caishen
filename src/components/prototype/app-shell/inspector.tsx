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
import { Card } from "~/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Figure, Property, Title } from "./cards";
import { useAutoAssign } from "./assign-money";
import { money, type Category } from "./model";
import { FieldError, MoveMoneyPopover } from "./move-money";
import { RtaCard } from "./ready-to-assign";
import { useShellData } from "./shell-data";
import { TargetEditor } from "./target-editor";
import type { Screen } from "./sidebar";
import { FundingRing } from "./views";
import styles from "./shell.module.css";

export function Inspector({
  screen,
  selectedId,
  checked,
}: {
  screen: Screen;
  selectedId: string | null;
  checked: string[];
}) {
  const { categories, loans, readyToAssign } = useShellData();
  if (screen.type === "plan") {
    // The plan's selection is its checked rows: one shows that category,
    // several show their combined details.
    const category =
      checked.length === 1
        ? categories.find((item) => item.id === checked[0])
        : undefined;
    return (
      <>
        <RtaCard amount={readyToAssign} />
        {checked.length > 1 ? (
          <CheckedDetails ids={checked} />
        ) : category ? (
          <CategoryDetails key={category.id} category={category} />
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
        <Card>
          <Title
            icon={<LoanIcon />}
            title="Loans"
            subtitle={
              loans.length
                ? "Nothing selected. Pick a loan to see its payoff."
                : "No loans yet."
            }
          />
          <Figure
            value={money(-loans.reduce((sum, item) => sum + item.balance, 0))}
            caption="Total remaining"
          />
        </Card>
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
      <Card>
        <Title icon={<LoanIcon />} title={loan.name} />
        <Figure value={money(-loan.balance)} caption="Remaining balance" />
      </Card>
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
// selection, or one category.
function AutoAssign({ scope }: { scope: Category[] }) {
  const { month } = useShellData();
  const [error, setError] = useState<string | null>(null);
  const { scope: categories, plan, run } = useAutoAssign(scope);
  return (
    <>
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
          <FieldError
            id={`${month.key}-inspector-auto-error`}
            message={error}
          />
        </div>
      )}
    </>
  );
}

function sum(categories: Category[], pick: (item: Category) => number) {
  return categories.reduce((total, item) => total + pick(item), 0);
}

function MonthDetails() {
  const { categories, month, costToBeMe, expectedIncome } = useShellData();
  const tabs = [
    {
      value: "auto-assign",
      label: "Auto-Assign",
      content: <AutoAssign scope={categories} />,
    },
    {
      value: "cost-to-be-me",
      label: "Cost to Be Me",
      content: (
        <div className={styles.tabBody}>
          <Figure
            value={money(costToBeMe)}
            caption={`What your targets ask for in ${month.short}`}
          />
          {expectedIncome === null ? (
            <p className={styles.tabEmpty}>
              Add expected income to see how much of it your targets use.
            </p>
          ) : (
            <Meter
              ratio={costToBeMe ? Math.min(1, expectedIncome / costToBeMe) : 1}
              tone={expectedIncome < costToBeMe ? "underfunded" : "funded"}
              label={
                expectedIncome < costToBeMe
                  ? `${money(costToBeMe - expectedIncome)} more than your expected ${money(expectedIncome)}`
                  : `${money(expectedIncome - costToBeMe)} left from your expected ${money(expectedIncome)}`
              }
            />
          )}
        </div>
      ),
    },
  ];
  return (
    <>
      <Card>
        <Property label="Assigned">
          {money(sum(categories, (item) => item.assigned))}
        </Property>
        <Property label="Activity">
          {money(sum(categories, (item) => item.activity))}
        </Property>
        <Property label="Available">
          {money(sum(categories, (item) => item.available))}
        </Property>
      </Card>
      <Card>
        <Tabs defaultValue="auto-assign">
          <TabsList aria-label="Month details">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map((tab) => (
            <TabsContent key={tab.value} value={tab.value}>
              {tab.content}
            </TabsContent>
          ))}
        </Tabs>
      </Card>
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
      <Card>
        <Title
          title={`${categories.length} ${categories.length === 1 ? "category" : "categories"} selected`}
          subtitle={categories.map((item) => item.name).join(", ")}
        />
        <Figure
          value={money(sum(categories, (item) => item.available))}
          caption={
            overspent.length
              ? `Available, with ${overspent.length} overspent`
              : "Available across the selection"
          }
          tone={overspent.length ? "overspent" : undefined}
        />
      </Card>
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
      <Card>
        <Tabs defaultValue="auto-assign">
          <TabsList aria-label="Selection details">
            <TabsTrigger value="auto-assign">Auto-Assign</TabsTrigger>
          </TabsList>
          <TabsContent value="auto-assign">
            <AutoAssign scope={categories} />
          </TabsContent>
        </Tabs>
      </Card>
    </>
  );
}

function CategoryDetails({ category }: { category: Category }) {
  const fallback =
    category.available > 0 ? "Money available" : "No money assigned yet";
  return (
    <>
      <Card>
        <Title
          icon={<FundingRing category={category} size={15} />}
          title={category.name}
          subtitle={category.group}
          menu
        />
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
      </Card>
      {category.pairs && <PairedBalance category={category} />}
      <Card>
        <Property label="Assigned">{money(category.assigned)}</Property>
        <Property label="Activity">{money(category.activity)}</Property>
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
      <Card>
        <Tabs defaultValue="target">
          <TabsList aria-label="Category details">
            <TabsTrigger value="target">Target</TabsTrigger>
            <TabsTrigger value="auto-assign">Auto-Assign</TabsTrigger>
          </TabsList>
          <TabsContent value="target">
            <TargetTab category={category} />
          </TabsContent>
          <TabsContent value="auto-assign">
            <AutoAssign key={category.id} scope={[category]} />
          </TabsContent>
        </Tabs>
      </Card>
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
            ? "Snoozed this month"
            : target.needed > 0
              ? `${money(target.needed)} more needed`
              : `${Math.round(category.fundedRatio * 100)}% funded`
        }
      />
      <div className={styles.tabActions}>
        <Button ref={opener} variant="quiet" onClick={() => setEditing(true)}>
          Edit target
        </Button>
      </div>
    </div>
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
