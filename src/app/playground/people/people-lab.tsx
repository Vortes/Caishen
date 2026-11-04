"use client";

import { useState } from "react";
import { money } from "~/components/app-shell/model";
import { Button } from "~/components/ui/button";
import { Popover } from "~/components/ui/popover";
import {
  DetailOption,
  DetailSeparator,
  SearchListDetail,
  type SearchListOption,
} from "~/components/ui/search-list";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "~/components/ui/segmented-control";
import styles from "~/components/playground/playground.module.css";

const demo: SearchListOption[] = [
  { value: "jordan", label: "Jordan", tag: "On Caishen", amount: -90382 },
  { value: "mom", label: "Mom", amount: 2450 },
  { value: "sam", label: "Sam", amount: 0 },
];
const worst: SearchListOption[] = [
  {
    value: "long",
    label:
      "Aleksandra Wiśniewska-Kowalczyk — Northwind International Research and Development",
    tag: "On Caishen",
    amount: -123456789,
  },
  { value: "cjk", label: "株式会社北風国際研究開発センター", amount: 98765432 },
  { value: "one", label: "J", amount: 0 },
  { value: "emoji", label: "👩🏽‍🔬 Zoë Nguyễn", amount: 1 },
  {
    value: "email",
    label: "bartholomew.fitzgerald@northwind-industries-holdings.example.com",
    amount: -1,
  },
];
const many = Array.from({ length: 1000 }, (_, index) => ({
  value: `person-${index}`,
  label: `${index % 2 ? "Sam" : "Alex"} ${index + 1}`,
  amount: index % 3 === 0 ? -12500 : index % 3 === 1 ? 0 : 12500,
}));
const datasets: Record<string, SearchListOption[]> = {
  demo,
  worst,
  empty: [],
  many,
};

// The playground layout is development-only. This exercises the production
// primitive with fixture props and never reads or writes a household.
export function PeopleLab({ initialData }: { initialData?: string }) {
  const [data, setData] = useState(
    initialData && Object.hasOwn(datasets, initialData) ? initialData : "demo",
  );
  const [result, setResult] = useState("No amount chosen");
  const options = datasets[data]!;
  return (
    <main className={styles.column}>
      <h1 className={styles.title}>People picker stress cases</h1>
      <div>
        <SegmentedControl
          aria-label="Fixture data"
          value={data}
          onValueChange={(next) => {
            setData(next);
            setResult("No amount chosen");
            const url = new URL(window.location.href);
            url.searchParams.set("data", next);
            window.history.replaceState(null, "", url);
          }}
        >
          <SegmentedControlItem value="demo">Demo</SegmentedControlItem>
          <SegmentedControlItem value="worst">Worst case</SegmentedControlItem>
          <SegmentedControlItem value="empty">Empty</SegmentedControlItem>
          <SegmentedControlItem value="many">1,000</SegmentedControlItem>
        </SegmentedControl>
      </div>
      <div>
        <Popover
          key={data}
          label="People picker stress cases"
          size="wide"
          trigger={<Button>Open picker</Button>}
        >
          <SearchListDetail
            label="Who is this for"
            placeholder="Find or add a person"
            empty="Type a name to share with someone"
            maxLength={120}
            createNoun="person"
            options={options}
            value={options[0]?.value ?? ""}
            defaultHighlight={options[0]?.value}
            detail={(highlight) => {
              const name =
                highlight?.kind === "option"
                  ? highlight.option.label
                  : highlight?.name;
              return {
                label: name ? `How much is for ${name}` : "How much",
                title: name ?? "Choose who it’s for",
                children: (
                  <>
                    <DetailOption
                      title="Half"
                      detail={money(5000)}
                      disabled={!highlight}
                      onClick={() => setResult(`${name}: ${money(5000)}`)}
                    />
                    <DetailOption
                      title="All of it"
                      detail={money(10000)}
                      disabled={!highlight}
                      onClick={() => setResult(`${name}: ${money(10000)}`)}
                    />
                    <DetailOption
                      title="An amount…"
                      disabled={!highlight}
                      onClick={() => setResult(`Custom amount for ${name}`)}
                    />
                    {options.length > 0 && (
                      <>
                        <DetailSeparator />
                        <DetailOption
                          title="Just mine"
                          onClick={() => setResult("Nothing shared")}
                        />
                      </>
                    )}
                  </>
                ),
              };
            }}
          />
        </Popover>
      </div>
      <output aria-live="polite">{result}</output>
    </main>
  );
}
