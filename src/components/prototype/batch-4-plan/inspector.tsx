"use client";

import {
  AlarmClockIcon,
  AlarmClockOffIcon,
  CreditCardIcon,
  EllipsisIcon,
  FolderIcon,
  PencilIcon,
  TargetIcon,
  UsersIcon,
  ZapIcon,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useState } from "react";
import { moveMonth, monthName } from "~/components/budget/format";
import { optionAmount } from "~/domain/auto-assign";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { IconButton } from "~/components/ui/icon-button";
import { Switch } from "~/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { usePortalContainer } from "~/components/ui/tooltip";
import { useAutoAssign } from "../app-shell/assign-money";
import { Figure, Property, Title } from "../app-shell/cards";
import { autoAssignOptions } from "../app-shell/inspector";
import { money, type Category } from "../app-shell/model";
import { FieldError, MoveMoneyPopover } from "../app-shell/move-money";
import { RtaCard } from "../app-shell/ready-to-assign";
import { useShellData } from "../app-shell/shell-data";
import { FundingRing } from "../app-shell/views";
import shellStyles from "../app-shell/shell.module.css";
import {
  ExpectedIncome,
  type IncomeEditing,
  type IncomeOffer,
} from "./expected-income";
import { canSnooze } from "./fixture";
import styles from "./batch-4.module.css";

export type SnoozePlacement = "switch" | "menu";

export type Snoozing = {
  placement: SnoozePlacement;
  isSnoozed: (category: Category, month: string) => boolean;
  setSnoozed: (category: Category, snoozed: boolean) => void;
};

export type Income = {
  editing: IncomeEditing;
  offer: IncomeOffer;
  set: (amount: number | null) => void;
  last: { month: string; amount: number } | null;
};

const shortMonth = (key: string) => monthName(key).split(" ")[0]!;

// The plan's details panel, as in the shell, with Batch 4's snooze and
// expected income in it. Everything else here is the shell's own.
export function PlanInspector({
  checked,
  snoozing,
  income,
  onUnavailable,
}: {
  checked: string[];
  snoozing: Snoozing;
  income: Income;
  onUnavailable: (what: string) => void;
}) {
  const { categories, readyToAssign } = useShellData();
  const category =
    checked.length === 1
      ? categories.find((item) => item.id === checked[0])
      : undefined;
  return (
    <>
      <RtaCard amount={readyToAssign} />
      {category ? (
        <CategoryDetails
          key={category.id}
          category={category}
          snoozing={snoozing}
          onUnavailable={onUnavailable}
        />
      ) : checked.length > 1 ? (
        <Card>
          <Title
            title={`${checked.length} categories selected`}
            subtitle="Select one category to snooze its target."
          />
        </Card>
      ) : (
        <MonthDetails income={income} />
      )}
    </>
  );
}

function AutoAssign({ scope }: { scope: Category[] }) {
  const { month } = useShellData();
  const [error, setError] = useState<string | null>(null);
  const { scope: categories, plan, run } = useAutoAssign(scope);
  return (
    <>
      <ul className={shellStyles.actionList}>
        {autoAssignOptions.map(([option, label]) => (
          <li key={option}>
            <button
              type="button"
              className={shellStyles.actionItem}
              disabled={plan(option).changes.length === 0}
              onClick={() => setError(run(option))}
            >
              <ZapIcon size={13} aria-hidden />
              <span>{label}</span>
              <span className={shellStyles.numeric}>
                {money(optionAmount(option, categories))}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <div className={shellStyles.autoAssignError}>
          <FieldError id={`${month.key}-auto-error`} message={error} />
        </div>
      )}
    </>
  );
}

function MonthDetails({ income }: { income: Income }) {
  const { categories, month, costToBeMe, expectedIncome, partner } =
    useShellData();
  const snoozed = categories.filter(
    (item) => item.autoAssign.targetProgress?.snoozed,
  );
  const sum = (pick: (item: Category) => number) =>
    categories.reduce((total, item) => total + pick(item), 0);
  return (
    <>
      <Card>
        <Property label="Assigned">
          {money(sum((item) => item.assigned))}
        </Property>
        <Property label="Activity">
          {money(sum((item) => item.activity))}
        </Property>
        <Property label="Available">
          {money(sum((item) => item.available))}
        </Property>
      </Card>
      <Card>
        <Tabs defaultValue="cost-to-be-me">
          <TabsList aria-label="Month details">
            <TabsTrigger value="auto-assign">Auto-Assign</TabsTrigger>
            <TabsTrigger value="cost-to-be-me">Cost to Be Me</TabsTrigger>
            {partner && <TabsTrigger value="shared">Shared</TabsTrigger>}
          </TabsList>
          <TabsContent value="auto-assign">
            <AutoAssign scope={categories} />
          </TabsContent>
          <TabsContent value="cost-to-be-me">
            <div className={shellStyles.tabBody}>
              <Figure
                value={money(costToBeMe)}
                caption={`What your targets ask for in ${month.short}`}
              />
              {snoozed.length > 0 && (
                <p className={styles.note}>
                  Leaves out{" "}
                  {snoozed.length === 1
                    ? snoozed[0]!.name
                    : `${snoozed.length} targets`}
                  , snoozed this month.
                </p>
              )}
              <ExpectedIncome
                key={month.key}
                monthKey={month.key}
                monthShort={month.short}
                cost={costToBeMe}
                amount={expectedIncome}
                editing={income.editing}
                offer={income.offer}
                last={
                  income.last && {
                    label: shortMonth(income.last.month),
                    amount: income.last.amount,
                  }
                }
                onSave={income.set}
              />
            </div>
          </TabsContent>
          {partner && (
            <TabsContent value="shared">
              <div className={shellStyles.tabBody}>
                <Property label="You owe" icon={UsersIcon}>
                  {money(partner.youOwe)}
                </Property>
                <Property label="Owed to you">
                  {money(partner.owedToYou)}
                </Property>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </Card>
    </>
  );
}

function CategoryDetails({
  category,
  snoozing,
  onUnavailable,
}: {
  category: Category;
  snoozing: Snoozing;
  onUnavailable: (what: string) => void;
}) {
  const fallback =
    category.available > 0 ? "Money available" : "No money assigned yet";
  return (
    <>
      <Card>
        {snoozing.placement === "menu" ? (
          <MenuTitle
            category={category}
            snoozing={snoozing}
            onUnavailable={onUnavailable}
          />
        ) : (
          <Title
            icon={<FundingRing category={category} size={15} />}
            title={category.name}
            subtitle={category.group}
            menu
          />
        )}
        <Figure
          value={money(category.available)}
          caption={category.status || fallback}
          tone={category.funding}
        />
        <div className={shellStyles.cardActions}>
          <MoveMoneyPopover category={category} align="start">
            {category.available < 0 ? (
              <Button variant="primary">Cover overspending</Button>
            ) : (
              <Button>Move money</Button>
            )}
          </MoveMoneyPopover>
        </div>
      </Card>
      <Card>
        <Property label="Assigned">{money(category.assigned)}</Property>
        <Property label="Activity">{money(category.activity)}</Property>
        <Property label="Last month">{money(category.carryover)}</Property>
        <Property label="Group" icon={FolderIcon}>
          {category.group}
        </Property>
        {category.pays && (
          <Property label="Pays" icon={CreditCardIcon}>
            {category.pays.name}
          </Property>
        )}
        {category.sharePercents.length > 0 && (
          <Property label="Shared" icon={UsersIcon}>
            Your share {category.sharePercents.map((value) => `${value}%`)}
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
            <TargetTab
              category={category}
              snoozing={snoozing}
              onUnavailable={onUnavailable}
            />
          </TabsContent>
          <TabsContent value="auto-assign">
            <AutoAssign scope={[category]} />
          </TabsContent>
        </Tabs>
      </Card>
    </>
  );
}

// Where the month on screen stands for snoozing. Like YNAB, only the
// current month can be snoozed; a snooze ends with its month.
function useSnoozeState(category: Category, snoozing: Snoozing) {
  const { month } = useShellData();
  const snoozed = snoozing.isSnoozed(category, month.key);
  const current = month.key === month.current;
  return {
    snoozed,
    current,
    allowed: canSnooze(category),
    label: current
      ? `Snooze for ${month.short}`
      : snoozed
        ? `Snoozed in ${month.short}`
        : `Snooze for ${month.short}`,
    hint: current
      ? snoozed
        ? `It asks for money again on ${shortMonth(moveMonth(month.key, 1))} 1.`
        : `Skips this target until ${shortMonth(moveMonth(month.key, 1))}. Its progress still shows.`
      : month.key > month.current
        ? `You can snooze only in the current month, ${monthName(month.current)}.`
        : snoozed
          ? "A snooze ends with its month."
          : `You can snooze only in the current month, ${monthName(month.current)}.`,
    meter: current ? `Snoozed for ${month.short}` : `Snoozed in ${month.short}`,
  };
}

function TargetTab({
  category,
  snoozing,
  onUnavailable,
}: {
  category: Category;
  snoozing: Snoozing;
  onUnavailable: (what: string) => void;
}) {
  const state = useSnoozeState(category, snoozing);
  const target = category.target;
  if (!category.rule || !target)
    return (
      <div className={shellStyles.tabEmpty}>
        <strong className={shellStyles.tabEmptyTitle}>
          {category.pays
            ? `How much do you want to pay toward ${category.pays.name}?`
            : `How much do you need for ${category.name}?`}
        </strong>
        <p>
          Set a target and Caishen works out how much to set aside each month to
          stay on track.
        </p>
        <Button
          variant="quiet"
          onClick={() => onUnavailable("Creating targets")}
        >
          Create target
        </Button>
      </div>
    );
  return (
    <div className={shellStyles.tabBody}>
      <Property label="Goal" icon={TargetIcon}>
        {target.action}
      </Property>
      <Property label="Due">{target.when}</Property>
      <Property label="Funded">
        {money(target.funded)} of {money(target.total)}
      </Property>
      <div
        className={shellStyles.meter}
        data-state={state.snoozed ? "snoozed" : category.funding}
      >
        <span className={shellStyles.meterTrack}>
          <span style={{ transform: `scaleX(${category.fundedRatio})` }} />
        </span>
        <span>
          {state.snoozed
            ? state.meter
            : target.needed > 0
              ? `${money(target.needed)} more needed`
              : `${Math.round(category.fundedRatio * 100)}% funded`}
        </span>
      </div>
      {snoozing.placement === "switch" && state.allowed && (
        <label
          className={styles.snoozeRow}
          data-disabled={!state.current || undefined}
        >
          <span className={styles.snoozeText}>
            <span className={styles.snoozeLabel}>{state.label}</span>
            <span className={styles.snoozeHint}>{state.hint}</span>
          </span>
          <Switch
            checked={state.snoozed}
            disabled={!state.current}
            onCheckedChange={(on) => snoozing.setSnoozed(category, on)}
          />
        </label>
      )}
      <div className={shellStyles.tabActions}>
        <Button
          variant="quiet"
          onClick={() => onUnavailable("Editing targets")}
        >
          Edit target
        </Button>
        {snoozing.placement === "menu" && state.snoozed && state.current && (
          <Button
            variant="quiet"
            onClick={() => snoozing.setSnoozed(category, false)}
          >
            Unsnooze
          </Button>
        )}
      </div>
    </div>
  );
}

// Variant B: snoozing lives in the card's ⋯ menu, which is inert in the
// shell today.
function MenuTitle({
  category,
  snoozing,
  onUnavailable,
}: {
  category: Category;
  snoozing: Snoozing;
  onUnavailable: (what: string) => void;
}) {
  const container = usePortalContainer();
  const state = useSnoozeState(category, snoozing);
  const { month } = useShellData();
  return (
    <div className={shellStyles.cardTitle}>
      <div className={shellStyles.cardTitleRow}>
        <FundingRing category={category} size={15} />
        <h2 className={shellStyles.truncate}>{category.name}</h2>
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <IconButton label={`${category.name} actions`}>
              <EllipsisIcon aria-hidden />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal container={container}>
            <DropdownMenu.Content
              className={shellStyles.menu}
              align="end"
              sideOffset={4}
              collisionPadding={12}
            >
              <DropdownMenu.Item
                className={shellStyles.menuItem}
                onSelect={() =>
                  onUnavailable(
                    category.rule ? "Editing targets" : "Creating targets",
                  )
                }
              >
                <PencilIcon size={14} aria-hidden />
                {category.rule ? "Edit target" : "Create target"}
              </DropdownMenu.Item>
              {state.allowed && (
                <>
                  <DropdownMenu.Separator
                    className={shellStyles.menuSeparator}
                  />
                  <DropdownMenu.Item
                    className={`${shellStyles.menuItem} ${styles.menuItemTall}`}
                    disabled={!state.current}
                    onSelect={() =>
                      snoozing.setSnoozed(category, !state.snoozed)
                    }
                  >
                    {state.snoozed ? (
                      <AlarmClockIcon size={14} aria-hidden />
                    ) : (
                      <AlarmClockOffIcon size={14} aria-hidden />
                    )}
                    <span className={styles.menuItemText}>
                      <span>
                        {state.snoozed && state.current
                          ? "Unsnooze target"
                          : `Snooze target for ${month.short}`}
                      </span>
                      {!state.current && (
                        <span className={styles.snoozeHint}>
                          Only in {monthName(month.current)}
                        </span>
                      )}
                    </span>
                  </DropdownMenu.Item>
                </>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      <p>{category.group}</p>
    </div>
  );
}
