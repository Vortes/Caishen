"use client";

import {
  CalendarDaysIcon,
  CreditCardIcon,
  EllipsisIcon,
  FolderIcon,
  LandmarkIcon,
  RefreshCwIcon,
  StickyNoteIcon,
  TargetIcon,
  ChartNoAxesCombinedIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import {
  accounts,
  allCategories,
  available,
  balance,
  fundedRatio,
  funding,
  groups,
  loans,
  money,
  month,
  transactions,
} from "./data";
import { RtaCard, type RtaState } from "./ready-to-assign";
import type { Screen } from "./sidebar";
import { FundingRing } from "./views";
import styles from "./shell.module.css";

export function Inspector({
  screen,
  selectedId,
  checked,
  rtaState,
}: {
  screen: Screen;
  selectedId: string | null;
  checked: string[];
  rtaState: RtaState;
}) {
  if (screen.type === "plan") {
    const category = allCategories.find((item) => item.id === selectedId);
    return (
      <>
        <RtaCard state={rtaState} />
        {checked.length ? (
          <CheckedDetails ids={checked} />
        ) : category ? (
          <CategoryDetails key={category.id} categoryId={category.id} />
        ) : (
          <MonthDetails />
        )}
      </>
    );
  }
  if (screen.type === "register") {
    const transaction = transactions.find((item) => item.id === selectedId);
    return transaction ? (
      <TransactionDetails id={transaction.id} />
    ) : (
      <AccountDetails accountId={screen.accountId} />
    );
  }
  const loan = loans.find((item) => item.id === selectedId) ?? loans[0]!;
  return (
    <>
      <Card>
        <Title icon={<ChartIcon />} title={loan.name} />
        <Figure value={money(-loan.balance)} caption="Remaining balance" />
      </Card>
      <Card>
        <Property label="Rate">{loan.rate}</Property>
        <Property label="Payment">{money(loan.payment)} monthly</Property>
        <Property label="Payoff">{loan.payoff}</Property>
      </Card>
    </>
  );
}

function ChartIcon() {
  return (
    <ChartNoAxesCombinedIcon
      size={15}
      className={styles.titleIcon}
      aria-hidden
    />
  );
}

function MonthDetails() {
  const categories = groups.flatMap((group) => group.categories);
  const sum = (pick: (value: (typeof categories)[number]) => number) =>
    categories.reduce((total, item) => total + pick(item), 0);
  const underfunded = categories.reduce(
    (total, item) =>
      total + Math.max(0, (item.target?.amount ?? 0) - item.assigned),
    0,
  );
  return (
    <>
      <Card>
        <Title
          icon={
            <CalendarDaysIcon
              size={15}
              className={styles.titleIcon}
              aria-hidden
            />
          }
          title={month.short}
          subtitle="Nothing selected. Pick a category to see its details."
        />
      </Card>
      <Card>
        <Property label="Assigned">
          {money(sum((item) => item.assigned))}
        </Property>
        <Property label="Activity">
          {money(sum((item) => item.activity))}
        </Property>
        <Property label="Available">{money(sum(available))}</Property>
      </Card>
      <Tabs
        tabs={[
          {
            label: "Auto-Assign",
            content: (
              <ul className={styles.actionList}>
                {[
                  ["Underfunded", underfunded],
                  ["Assigned last month", 702400],
                  ["Spent last month", 688912],
                  ["Average assigned", 695150],
                  ["Reset available amounts", 0],
                ].map(([label, value]) => (
                  <li key={label}>
                    <button type="button" className={styles.actionItem}>
                      <ZapIcon size={13} aria-hidden />
                      <span>{label}</span>
                      <span className={styles.numeric}>
                        {money(value as number)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ),
          },
          {
            label: "Cost to Be Me",
            content: (
              <div className={styles.tabBody}>
                <Figure
                  value={money(711400)}
                  caption="Each month, from your targets"
                />
                <Meter ratio={0.78} label="78% covered by expected income" />
              </div>
            ),
          },
        ]}
      />
    </>
  );
}

function CheckedDetails({ ids }: { ids: string[] }) {
  const categories = allCategories.filter((item) => ids.includes(item.id));
  const sum = (pick: (value: (typeof categories)[number]) => number) =>
    categories.reduce((total, item) => total + pick(item), 0);
  const underfunded = categories.reduce(
    (total, item) =>
      total + Math.max(0, (item.target?.amount ?? 0) - item.assigned),
    0,
  );
  const overspent = categories.filter((item) => available(item) < 0);
  return (
    <>
      <Card>
        <Title
          title={`${categories.length} ${categories.length === 1 ? "category" : "categories"} selected`}
          subtitle={categories.map((item) => item.name).join(", ")}
        />
        <Figure
          value={money(sum(available))}
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
          {money(sum((item) => item.assigned))}
        </Property>
        <Property label="Activity">
          {money(sum((item) => item.activity))}
        </Property>
        <Property label="Last month">
          {money(sum((item) => item.carryover))}
        </Property>
      </Card>
      <Tabs
        tabs={[
          {
            label: "Auto-Assign",
            content: (
              <ul className={styles.actionList}>
                {[
                  ["Underfunded", underfunded],
                  ["Assigned last month", sum((item) => item.assigned)],
                  ["Spent last month", -sum((item) => item.activity)],
                ].map(([label, amount]) => (
                  <li key={label}>
                    <button type="button" className={styles.actionItem}>
                      <ZapIcon size={13} aria-hidden />
                      <span>{label}</span>
                      <span className={styles.numeric}>
                        {money(amount as number)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ),
          },
        ]}
      />
    </>
  );
}

function CategoryDetails({ categoryId }: { categoryId: string }) {
  const category = allCategories.find((item) => item.id === categoryId)!;
  const state = funding(category);
  const value = available(category);
  const needed = category.target
    ? Math.max(0, category.target.amount - category.assigned)
    : 0;
  const status = {
    funded: category.target ? "Fully funded this month" : "Money available",
    underfunded: `${money(needed)} more needed${category.target?.due ? ` by ${category.target.due}` : " this month"}`,
    overspent: `Overspent by ${money(-value)}. Cover it from another category.`,
    empty: "No money assigned yet",
  }[state];
  return (
    <>
      <Card>
        <Title
          icon={<FundingRing category={category} size={15} />}
          title={category.name}
          subtitle={category.group}
          menu
        />
        <Figure value={money(value)} caption={status} tone={state} />
      </Card>
      <Card>
        <Property label="Assigned">{money(category.assigned)}</Property>
        <Property label="Activity">{money(category.activity)}</Property>
        <Property label="Last month">{money(category.carryover)}</Property>
        <Property label="Group" icon={FolderIcon}>
          {category.group}
        </Property>
      </Card>
      <Tabs
        tabs={[
          {
            label: "Target",
            content: category.target ? (
              <div className={styles.tabBody}>
                <Property label="Amount" icon={TargetIcon}>
                  {money(category.target.amount)}
                </Property>
                <Property label="Repeats">{category.target.cadence}</Property>
                {category.target.due && (
                  <Property label="Due">{category.target.due}</Property>
                )}
                <Meter
                  ratio={fundedRatio(category)}
                  tone={state}
                  label={
                    state === "overspent"
                      ? `Target met, but spending is ${money(-value)} over`
                      : `${Math.round(fundedRatio(category) * 100)}% funded`
                  }
                />
              </div>
            ) : (
              <p className={styles.tabEmpty}>
                No target yet. Set one to see what this category needs each
                month.
                <button type="button" className={styles.textButton}>
                  Create target
                </button>
              </p>
            ),
          },
          {
            label: "Auto-Assign",
            content: (
              <ul className={styles.actionList}>
                {[
                  ["Underfunded", needed],
                  ["Assigned last month", category.assigned],
                  ["Spent last month", -category.activity],
                ].map(([label, amount]) => (
                  <li key={label}>
                    <button type="button" className={styles.actionItem}>
                      <ZapIcon size={13} aria-hidden />
                      <span>{label}</span>
                      <span className={styles.numeric}>
                        {money(amount as number)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ),
          },
          {
            label: "Notes",
            content: category.note ? (
              <p className={styles.note}>
                <StickyNoteIcon size={13} aria-hidden />
                {category.note}
              </p>
            ) : (
              <p className={styles.tabEmpty}>
                No notes. Use notes to remember why this category exists.
              </p>
            ),
          },
        ]}
      />
    </>
  );
}

function AccountDetails({ accountId }: { accountId: string | null }) {
  const account = accounts.find((item) => item.id === accountId);
  const scope = account ? [account] : accounts;
  const cleared = scope.reduce((sum, item) => sum + item.cleared, 0);
  const uncleared = scope.reduce((sum, item) => sum + item.uncleared, 0);
  const review = transactions.filter(
    (item) => item.needsReview && (!account || item.accountId === account.id),
  );
  return (
    <>
      <Card>
        <Title
          icon={
            account?.kind === "credit" ? (
              <CreditCardIcon
                size={15}
                className={styles.titleIcon}
                aria-hidden
              />
            ) : (
              <LandmarkIcon
                size={15}
                className={styles.titleIcon}
                aria-hidden
              />
            )
          }
          title={account?.name ?? "All accounts"}
          subtitle={
            account
              ? `${account.institution} · ${account.syncedAgo === "Needs reconnect" ? "Connection needs attention" : `Synced ${account.syncedAgo}`}`
              : `${accounts.length} accounts on budget`
          }
          menu={Boolean(account)}
        />
        <Figure value={money(cleared + uncleared)} caption="Working balance" />
      </Card>
      <Card>
        <Property label="Cleared">{money(cleared)}</Property>
        <Property label="Uncleared">{money(uncleared)}</Property>
        {account && (
          <Property label="Sync" icon={RefreshCwIcon}>
            {account.syncedAgo === "Needs reconnect" ? (
              <span className={styles.chip} data-tone="amber">
                Reconnect
              </span>
            ) : (
              account.syncedAgo
            )}
          </Property>
        )}
      </Card>
      <Tabs
        tabs={[
          {
            label: `To review ${review.length}`,
            content: review.length ? (
              <ul className={styles.actionList}>
                {review.map((item) => (
                  <li key={item.id}>
                    <div className={styles.actionItem}>
                      <span className={styles.reviewDot} data-on />
                      <span>{item.payee}</span>
                      <span className={styles.numeric}>
                        {money(item.amount, true)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.tabEmpty}>Nothing to review.</p>
            ),
          },
          {
            label: "Balances",
            content: (
              <ul className={styles.actionList}>
                {scope.map((item) => (
                  <li key={item.id}>
                    <div className={styles.actionItem}>
                      <span>{item.name}</span>
                      <span className={styles.numeric}>
                        {money(balance(item))}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ),
          },
        ]}
      />
    </>
  );
}

function TransactionDetails({ id }: { id: string }) {
  const item = transactions.find((entry) => entry.id === id)!;
  const account = accounts.find((entry) => entry.id === item.accountId);
  const category = allCategories.find((entry) => entry.id === item.categoryId);
  return (
    <>
      <Card>
        <Title
          title={item.payee}
          subtitle={`${item.date} · ${account?.name}`}
          menu
        />
        <Figure
          value={money(item.amount, true)}
          caption={
            item.status === "pending"
              ? "Pending at the bank"
              : item.status === "cleared"
                ? "Cleared"
                : "Reconciled"
          }
          tone={item.amount > 0 ? "funded" : undefined}
        />
      </Card>
      <Card>
        <Property label="Category" icon={FolderIcon}>
          {category ? (
            category.name
          ) : item.amount > 0 ? (
            "Ready to Assign"
          ) : (
            <span className={styles.chip} data-tone="amber">
              Needs category
            </span>
          )}
        </Property>
        <Property
          label="Account"
          icon={account?.kind === "credit" ? CreditCardIcon : LandmarkIcon}
        >
          {account?.name}
        </Property>
        <Property label="Date" icon={CalendarDaysIcon}>
          {item.date}, 2026
        </Property>
        <Property label="Memo" icon={StickyNoteIcon}>
          {item.memo ?? <span className={styles.faint}>Add a memo</span>}
        </Property>
      </Card>
      {item.needsReview && (
        <Card>
          <p className={styles.reviewNote}>
            Imported from {account?.institution}. Check the category, then mark
            it reviewed.
          </p>
          <button
            type="button"
            className={`${styles.control} ${styles.secondaryButton}`}
          >
            Mark reviewed
          </button>
        </Card>
      )}
    </>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <section className={styles.card}>{children}</section>;
}

function Title({
  icon,
  title,
  subtitle,
  menu,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  menu?: boolean;
}) {
  return (
    <div className={styles.cardTitle}>
      <div className={styles.cardTitleRow}>
        {icon}
        <h2 className={styles.truncate}>{title}</h2>
        {menu && (
          <button
            type="button"
            className={styles.iconButton}
            aria-label={`${title} actions`}
          >
            <EllipsisIcon size={15} aria-hidden />
          </button>
        )}
      </div>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}

function Figure({
  value,
  caption,
  tone,
}: {
  value: string;
  caption: string;
  tone?: string;
}) {
  return (
    <div className={styles.figure} data-state={tone}>
      <strong>{value}</strong>
      <span>{caption}</span>
    </div>
  );
}

function Property({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <div className={styles.property}>
      <span className={styles.propertyLabel}>{label}</span>
      <span className={styles.propertyValue}>
        {Icon && <Icon size={13} aria-hidden />}
        {children}
      </span>
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

function Tabs({ tabs }: { tabs: { label: string; content: ReactNode }[] }) {
  const [active, setActive] = useState(0);
  const id = useId();
  return (
    <section className={styles.card}>
      <div className={styles.tabs} role="tablist">
        {tabs.map((tab, index) => (
          <button
            type="button"
            role="tab"
            key={tab.label}
            id={`${id}-tab-${index}`}
            aria-selected={active === index}
            aria-controls={`${id}-panel`}
            tabIndex={active === index ? 0 : -1}
            className={`${styles.control} ${styles.tab}`}
            onClick={() => setActive(index)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft")
                return;
              const next =
                (active + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                tabs.length;
              setActive(next);
              document.getElementById(`${id}-tab-${next}`)?.focus();
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${active}`}
      >
        {tabs[active]?.content}
      </div>
    </section>
  );
}
