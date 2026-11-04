"use client";

import { useEffect, useRef, useState } from "react";
import { newId } from "~/components/budget/format";
import { Button } from "~/components/ui/button";
import { Field, FormError } from "~/components/ui/field";
import { Tag } from "~/components/ui/tag";
import { CategoryField, spendingCategoryOptions } from "./category-field";
import { Section } from "./cards";
import {
  money,
  shortDay,
  type Category,
  type PartnerFunding,
  type PartnerPurchase,
} from "./model";
import { useShellData } from "./shell-data";
import { useTransactionEntry } from "./transaction-entry";
import styles from "./partner-purchases.module.css";

const FIRST = 6;

// Your part of each of the partner's purchases, with its category and
// whether that category set it aside: why the envelope is short, and where
// to choose the category it still needs.
export function PartnerPurchases({
  category,
  funding,
}: {
  category: Category;
  funding: PartnerFunding;
}) {
  const { month } = useShellData();
  const [all, setAll] = useState(false);
  const title = `Your part of ${category.name}’s purchases`;
  const moved = `Moved out of ${category.name}’s envelope`;
  const { purchases, movedOut } = funding;
  const shown = all ? purchases : purchases.slice(0, FIRST);
  const list = useRef<HTMLUListElement>(null);
  // Show all goes away once pressed, so focus moves to the first purchase
  // it showed.
  const revealed = useRef(false);
  useEffect(() => {
    if (!revealed.current) return;
    revealed.current = false;
    (list.current?.children[FIRST] as HTMLElement | undefined)?.focus();
  }, [all]);
  return (
    <Section
      id="partner-purchases"
      title={title}
      subtitle={
        purchases.length ? undefined : `No purchases in ${month.short}.`
      }
    >
      {/* Money moved out after categories funded the purchases, which no
          purchase shows as short, so the list adds up to what's needed. */}
      {movedOut > 0 && (
        <p className={`${styles.row} ${styles.movedOut}`}>
          <strong className={styles.payee} title={moved}>
            {moved}
          </strong>
          <span className={styles.state} data-state="short">
            {money(movedOut)} short
          </span>
        </p>
      )}
      {purchases.length > 0 && (
        <ul ref={list} className={styles.list} aria-label={title}>
          {shown.map((purchase) => (
            <PurchaseRow key={purchase.entryId} purchase={purchase} />
          ))}
        </ul>
      )}
      {!all && purchases.length > FIRST && (
        <div className={styles.more}>
          <Button
            variant="quiet"
            onClick={() => {
              revealed.current = true;
              setAll(true);
            }}
          >
            Show all {purchases.length}
          </Button>
        </div>
      )}
    </Section>
  );
}

function PurchaseRow({ purchase }: { purchase: PartnerPurchase }) {
  const needsCategory = purchase.state === "needs-category";
  return (
    <li className={styles.row} tabIndex={-1}>
      <span className={styles.line}>
        <strong className={styles.payee} title={purchase.payee}>
          {purchase.payee}
        </strong>
        <span className={styles.amount}>{money(purchase.amount)}</span>
      </span>
      <span className={styles.meta}>
        <span className={styles.where}>
          <span className={styles.date}>{shortDay(purchase.date)}</span>
          {!needsCategory && <span aria-hidden>·</span>}
          {needsCategory ? (
            <Tag tone="attention">Needs a category</Tag>
          ) : (
            <span className={styles.category} title={purchase.category}>
              {purchase.category}
            </span>
          )}
        </span>
        {/* Once nothing of it is still to fund, a purchase that needs a
            category only says so. */}
        {(!needsCategory || purchase.short > 0) && (
          <span className={styles.state} data-state={purchase.state}>
            {purchase.state === "set-aside"
              ? "Set aside"
              : purchase.state === "short"
                ? `${money(purchase.short)} short`
                : "Not set aside"}
          </span>
        )}
      </span>
      {needsCategory && <PurchaseCategory purchase={purchase} />}
    </li>
  );
}

// The partner register's category picker, which saves your category for
// the purchase as soon as one is picked.
function PurchaseCategory({ purchase }: { purchase: PartnerPurchase }) {
  const { view, saveCommand } = useTransactionEntry();
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const options = spendingCategoryOptions(view);
  const choose = (next: string) => {
    setCategoryId(next);
    setError(null);
    if (!next) return;
    const label = options.find((option) => option.value === next)?.label;
    const failure = saveCommand(
      {
        type: "partner.categorize",
        id: newId(),
        entryId: purchase.entryId,
        categoryId: next,
      },
      `Your ${money(purchase.amount)} of ${purchase.payee} is in ${label ?? "that category"}. Only you see that.`,
    );
    if (failure) {
      setCategoryId("");
      setError(failure);
    }
  };
  return (
    <div className={styles.picker}>
      <Field label={`Category for ${purchase.payee}`} labelHidden>
        <CategoryField
          value={categoryId}
          options={options}
          placeholder="Choose a category"
          onChange={choose}
        />
      </Field>
      {error && <FormError>{error}</FormError>}
    </div>
  );
}
