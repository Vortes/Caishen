"use client";

import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Skeleton, type SkeletonShape } from "~/components/ui/skeleton";
import { Tag } from "~/components/ui/tag";
import { Figure } from "../cards";
import { FundingBar } from "../funding-bar";
import { RtaCardLayout } from "../ready-to-assign";
import shell from "../shell.module.css";
import styles from "./design-system.module.css";

const shapes: {
  shape: SkeletonShape;
  width?: number;
  rule: string;
  replaces: ReactNode;
}[] = [
  {
    shape: "text",
    width: 96,
    rule: "Any line of text or an amount. The default.",
    replaces: <span>Groceries</span>,
  },
  {
    shape: "figure",
    width: 112,
    rule: "A card's headline amount.",
    replaces: <Figure value="$62.99" caption="Ready to Assign" />,
  },
  {
    shape: "avatar",
    rule: "The budget's avatar.",
    replaces: (
      <span className={shell.avatar} aria-hidden>
        P
      </span>
    ),
  },
  {
    shape: "pill",
    width: 68,
    rule: "A Tag or a funding pill.",
    replaces: <Tag>Uncategorized</Tag>,
  },
  {
    shape: "button",
    width: 136,
    rule: "A Button or IconButton.",
    replaces: <Button>Assign money</Button>,
  },
  {
    shape: "button-sm",
    width: 96,
    rule: "A small Button, like the plan's view chips.",
    replaces: <Button size="sm">Overspent</Button>,
  },
  {
    shape: "funding-bar",
    width: 160,
    rule: "The funding bar under a category's name.",
    replaces: (
      <span className={styles.specimenBar}>
        <FundingBar
          category={{
            funding: "funded",
            status: "",
            activity: -5_000,
            available: 7_500,
          }}
        >
          <span>Dining</span>
        </FundingBar>
      </span>
    ),
  },
];

export function SkeletonSpecimens() {
  return (
    <section className={styles.section} aria-labelledby="skeleton">
      <h2 id="skeleton">Skeleton</h2>
      <p className={styles.lead}>
        A bone holds the place of one piece of data until it loads, shaped like
        what replaces it, so nothing moves when the data arrives. Text that
        reads the same in every budget shows as itself. One band of shine sweeps
        every bone at once; with reduced motion, bones hold still.
      </p>

      <div className={styles.variantTable}>
        <div className={styles.variantHead} aria-hidden>
          <span>Shape</span>
          <span>Bone</span>
          <span>Replaces</span>
        </div>
        {shapes.map(({ shape, width, rule, replaces }) => (
          <div key={shape} className={styles.variantRow}>
            <div>
              <code className={styles.code}>{shape}</code>
              <p>{rule}</p>
            </div>
            <span>
              <Skeleton shape={shape} width={width} />
            </span>
            <span>{replaces}</span>
          </div>
        ))}
      </div>

      <h3 className={styles.subheading}>In place</h3>
      <div className={styles.contexts}>
        <figure className={styles.context}>
          <Card>
            <div className={shell.rtaCard}>
              <span className={shell.rtaCardLabel}>
                <Skeleton width={104} />
              </span>
              <Skeleton shape="figure" width={112} />
              <div className={shell.rtaAction}>
                <Skeleton shape="button" />
              </div>
            </div>
          </Card>
          <figcaption>
            Loading: the label varies with the amount, so it&rsquo;s a bone too.
          </figcaption>
        </figure>
        <figure className={styles.context}>
          <RtaCardLayout amount={6_299} />
          <figcaption>Loaded: every line lands where its bone was.</figcaption>
        </figure>
      </div>
    </section>
  );
}
