"use client";

import { LinkIcon } from "lucide-react";
import type { PartnerImportMatch } from "~/components/transactions/import-draft";
import { Button } from "~/components/ui/button";
import { money, shortDay } from "./model";
import { useShellData } from "./shell-data";
import { useTransactionEntry } from "./transaction-entry";
import styles from "./partner-register.module.css";

// A bank import that may be a purchase recorded before it arrived. The
// payer says which, so it's never counted twice or matched to the wrong
// purchase; until then it waits here, uncounted.
export function PartnerMatches({ matches }: { matches: PartnerImportMatch[] }) {
  const entry = useTransactionEntry();
  const { view } = entry;
  const { accounts } = useShellData();
  const partner =
    accounts.find((account) => account.kind === "partner")?.name ??
    "Your partner";
  const single = matches.length === 1;
  return (
    <div className={styles.matches}>
      {matches.map((match) => {
        const recorder =
          match.recordedBy === view.budget.userId ? "You" : partner;
        return (
          <div key={match.entryId} className={styles.match}>
            <LinkIcon size={13} aria-hidden />
            <p>
              {recorder} recorded {match.payee} on {shortDay(match.date)}:{" "}
              {money(match.amount)}, {partner}&rsquo;s share{" "}
              {money(match.share)}.{" "}
              <span className={styles.matchHint}>
                {single
                  ? "If this import is that purchase, match it so it counts once."
                  : "Match the one this import is, so it counts once."}
              </span>
            </p>
            <Button
              size="sm"
              variant={single ? "primary" : "secondary"}
              data-partner-match
              onClick={() => entry.matchImport(match)}
            >
              Match
            </Button>
          </div>
        );
      })}
    </div>
  );
}
