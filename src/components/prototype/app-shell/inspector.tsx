"use client";

import {
  CalendarDaysIcon,
  CreditCardIcon,
  FolderIcon,
  HistoryIcon,
  InboxIcon,
  LandmarkIcon,
  RefreshCwIcon,
  TargetIcon,
  ChartNoAxesCombinedIcon,
  UsersIcon,
  ZapIcon,
} from "lucide-react";
import { optionAmount, type AutoAssignOption } from "~/domain/auto-assign";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Tag } from "~/components/ui/tag";
import { Figure, Property, Title } from "./cards";
import { money, shortDay, type Category, type Transaction } from "./model";
import { MoveMoneyPopover } from "./move-money";
import { RtaCard } from "./ready-to-assign";
import { useShellData } from "./shell-data";
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
  const { categories, transactions, loans, readyToAssign } = useShellData();
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
  if (screen.type === "register") {
    const transaction = transactions.find((item) => item.id === selectedId);
    return transaction ? (
      <TransactionDetails key={transaction.id} item={transaction} />
    ) : (
      <AccountDetails accountId={screen.accountId} />
    );
  }
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

const autoAssignOptions: [AutoAssignOption, string][] = [
  ["underfunded", "Underfunded"],
  ["assigned-last-month", "Assigned last month"],
  ["spent-last-month", "Spent last month"],
  ["average-assigned", "Average assigned"],
  ["average-spent", "Average spent"],
  ["reduce-overfunding", "Reduce overfunding"],
];

function AutoAssign({ scope }: { scope: Category[] }) {
  const categories = scope.map((item) => item.autoAssign);
  return (
    <AutoAssignList
      items={autoAssignOptions.map(([option, label]) => [
        label,
        optionAmount(option, categories),
      ])}
    />
  );
}

function sum(categories: Category[], pick: (item: Category) => number) {
  return categories.reduce((total, item) => total + pick(item), 0);
}

function MonthDetails() {
  const {
    categories,
    month,
    costToBeMe,
    expectedIncome,
    partner,
    reimbursements,
  } = useShellData();
  const owed = reimbursements.filter((item) => item.outstanding > 0);
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
  if (partner)
    tabs.push({
      value: "shared",
      label: "Shared",
      content: (
        <div className={styles.tabBody}>
          <Property label="You owe" icon={UsersIcon}>
            {money(partner.youOwe)}
          </Property>
          <Property label="Owed to you">{money(partner.owedToYou)}</Property>
          <p className={styles.tabEmpty}>
            {partner.youOwe === partner.owedToYou
              ? `You and ${partner.name} are settled up.`
              : partner.youOwe > partner.owedToYou
                ? `You owe ${partner.name} ${money(partner.youOwe - partner.owedToYou)} overall.`
                : `${partner.name} owes you ${money(partner.owedToYou - partner.youOwe)} overall.`}
          </p>
        </div>
      ),
    });
  if (reimbursements.length)
    tabs.push({
      value: "reimbursements",
      label: `Reimbursements ${owed.length}`,
      content: owed.length ? (
        <ul className={styles.actionList}>
          {owed.map((item) => (
            <li key={item.id}>
              <div className={styles.actionItem}>
                <span>{item.name}</span>
                <span className={styles.numeric}>
                  {money(item.outstanding)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.tabEmpty}>Every reimbursement has arrived.</p>
      ),
    });
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
  const target = category.target;
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
      <Card>
        <Property label="Assigned">{money(category.assigned)}</Property>
        <Property label="Activity">{money(category.activity)}</Property>
        <Property label="Last month">{money(category.carryover)}</Property>
        <Property label="Group" icon={FolderIcon}>
          {category.group}
        </Property>
        {category.pays && (
          <Property
            label="Pays"
            icon={category.pays.type === "card" ? CreditCardIcon : LandmarkIcon}
          >
            {category.pays.name}
          </Property>
        )}
      </Card>
      {(category.sharePercents.length > 0 || category.reserved > 0) && (
        <Card>
          {category.sharePercents.length > 0 && (
            <Property label="Shared" icon={UsersIcon}>
              Your share{" "}
              {category.sharePercents.map((value) => `${value}%`).join(", ")}
            </Property>
          )}
          {category.reserved > 0 && (
            <>
              <Property label="Reserved">{money(category.reserved)}</Property>
              <Property label="Spendable">{money(category.spendable)}</Property>
            </>
          )}
        </Card>
      )}
      <Card>
        <Tabs defaultValue="target">
          <TabsList aria-label="Category details">
            <TabsTrigger value="target">Target</TabsTrigger>
            <TabsTrigger value="auto-assign">Auto-Assign</TabsTrigger>
          </TabsList>
          <TabsContent value="target">
            {target ? (
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
              </div>
            ) : (
              <p className={styles.tabEmpty}>
                No target yet. Set one to see what this category needs each
                month.
                <Button variant="quiet">Create target</Button>
              </p>
            )}
          </TabsContent>
          <TabsContent value="auto-assign">
            <AutoAssign scope={[category]} />
          </TabsContent>
        </Tabs>
      </Card>
    </>
  );
}

function AccountDetails({ accountId }: { accountId: string | null }) {
  const { accounts, transactions } = useShellData();
  const account = accounts.find((item) => item.id === accountId);
  const scope = account ? [account] : accounts;
  const balance = scope.reduce((total, item) => total + item.balance, 0);
  const pending = scope.reduce((total, item) => total + item.pending, 0);
  const review = transactions.filter(
    (item) => item.needsReview && (!account || item.accountId === account.id),
  );
  const connection = account?.connection;
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
              ? connection
                ? `${connection.institution} · ${connection.needsAttention ? "Connection needs attention" : `Synced ${connection.synced}`}`
                : "Manual account"
              : `${accounts.length} ${accounts.length === 1 ? "account" : "accounts"} on budget`
          }
          menu={Boolean(account)}
        />
        <Figure value={money(balance)} caption="Working balance" />
      </Card>
      <Card>
        <Property label="Posted">{money(balance - pending)}</Property>
        <Property label="Pending">{money(pending)}</Property>
        {account && (
          <Property label="Sync" icon={RefreshCwIcon}>
            {!connection ? (
              <span className={styles.faint}>Not connected to a bank</span>
            ) : connection.needsAttention ? (
              <Tag tone="attention">Reconnect</Tag>
            ) : (
              connection.synced
            )}
          </Property>
        )}
      </Card>
      <Card>
        <Tabs defaultValue="review">
          <TabsList aria-label="Account details">
            <TabsTrigger value="review">To review {review.length}</TabsTrigger>
            <TabsTrigger value="balances">Balances</TabsTrigger>
          </TabsList>
          <TabsContent value="review">
            {review.length ? (
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
            )}
          </TabsContent>
          <TabsContent value="balances">
            {scope.length ? (
              <ul className={styles.actionList}>
                {scope.map((item) => (
                  <li key={item.id}>
                    <div className={styles.actionItem}>
                      <span>{item.name}</span>
                      <span className={styles.numeric}>
                        {money(item.balance)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.tabEmpty}>No accounts yet.</p>
            )}
          </TabsContent>
        </Tabs>
      </Card>
    </>
  );
}

const longDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

function TransactionDetails({ item }: { item: Transaction }) {
  const account = useShellData().accounts.find(
    (entry) => entry.id === item.accountId,
  );
  const fromBank = item.source === "bank";
  return (
    <>
      <Card>
        <Title
          title={item.payee}
          subtitle={`${shortDay(item.date)} · ${account?.name ?? "Unlinked bank account"}`}
          menu
        />
        <Figure
          value={money(item.amount, true)}
          caption={
            fromBank
              ? "Waiting in your bank inbox"
              : item.status === "pending"
                ? "Pending at the bank"
                : "Posted"
          }
          tone={item.amount > 0 ? "funded" : undefined}
        />
      </Card>
      <Card>
        <Property label="Category" icon={FolderIcon}>
          {item.needsCategory ? (
            <Tag tone="attention">{item.categoryLabel}</Tag>
          ) : (
            <span className={styles.truncate}>{item.categoryLabel}</span>
          )}
        </Property>
        <Property
          label="Account"
          icon={account?.kind === "credit" ? CreditCardIcon : LandmarkIcon}
        >
          {account?.name ?? <Tag tone="attention">Not linked</Tag>}
        </Property>
        <Property label="Date" icon={CalendarDaysIcon}>
          {longDate(item.date)}
        </Property>
        {item.forMonth && (
          <Property label="Counts for">{item.forMonth}</Property>
        )}
        {item.shared && (
          <Property label="Shared" icon={UsersIcon}>
            Split with your partner
          </Property>
        )}
      </Card>
      {item.needsReview && (
        <Card>
          <p className={styles.reviewNote}>
            {fromBank ? (
              <>
                <InboxIcon size={13} aria-hidden />
                {item.reviewReason ?? "Imported from your bank."}
              </>
            ) : (
              "Check the category, then mark it reviewed."
            )}
          </p>
          <div>
            <Button variant="primary">
              {fromBank ? "Review import" : "Mark reviewed"}
            </Button>
          </div>
        </Card>
      )}
      {item.history.length > 1 && (
        <Card>
          <Tabs defaultValue="history">
            <TabsList aria-label="Transaction details">
              <TabsTrigger value="history">
                History {item.history.length}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="history">
              <ul className={styles.actionList}>
                {[...item.history].reverse().map((entry, index) => (
                  <li key={index}>
                    <div className={styles.actionItem}>
                      <HistoryIcon size={13} aria-hidden />
                      <span>{entry.reason}</span>
                      <span className={styles.numeric}>
                        {money(entry.amount, true)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </TabsContent>
          </Tabs>
        </Card>
      )}
    </>
  );
}

function AutoAssignList({ items }: { items: [string, number][] }) {
  return (
    <ul className={styles.actionList}>
      {items.map(([label, amount]) => (
        <li key={label}>
          <button type="button" className={styles.actionItem}>
            <ZapIcon size={13} aria-hidden />
            <span>{label}</span>
            <span className={styles.numeric}>{money(amount)}</span>
          </button>
        </li>
      ))}
    </ul>
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
