"use client";
import { useId, useRef, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { Field } from "~/components/ui/field";
import { TextInput } from "~/components/ui/text-input";
import { z } from "zod";
import batch from "./entry.module.css";
import styles from "./onboarding.module.css";
type Answers = {
  home: "rent" | "own" | "neither";
  travel: string[];
  family: string[];
  debt: string[];
  goals: string[];
};
export type CategoryDraft = {
  answers: Answers;
  unchecked: string[];
  custom: string[];
};
export const categoryDraftSchema: z.ZodType<CategoryDraft> = z.object({
  answers: z.object({
    home: z.enum(["rent", "own", "neither"]),
    travel: z.array(z.string()),
    family: z.array(z.string()),
    debt: z.array(z.string()),
    goals: z.array(z.string()),
  }),
  unchecked: z.array(z.string()),
  custom: z.array(z.string().max(80)),
});
export const initialCategories: CategoryDraft = {
  answers: {
    home: "rent",
    travel: ["car"],
    family: [],
    debt: ["card"],
    goals: ["emergency"],
  },
  unchecked: [],
  custom: [],
};
const questions: {
  id: keyof Omit<Answers, "home">;
  label: string;
  options: [string, string][];
  // An answer that picks nothing, so the question can still be answered.
  none?: string;
}[] = [
  {
    id: "travel",
    label: "How do you get around?",
    options: [
      ["car", "Car"],
      ["transit", "Public transit"],
      ["bike", "Bike or on foot"],
    ],
  },
  {
    id: "family",
    label: "Who else depends on your budget?",
    options: [
      ["kids", "Kids"],
      ["pets", "Pets"],
    ],
    none: "Just me",
  },
  {
    id: "debt",
    label: "Any debt you’re paying down?",
    options: [
      ["card", "Credit card"],
      ["student", "Student loan"],
      ["auto", "Car loan"],
    ],
    none: "No debt",
  },
  {
    id: "goals",
    label: "What are you saving for?",
    options: [
      ["emergency", "Emergency fund"],
      ["vacation", "Vacation"],
      ["home", "A home"],
      ["car", "Next car"],
    ],
    none: "Not yet",
  },
];

export type Group = { name: string; categories: string[] };

// The starting groups the answers produce, in the order the plan shows them.
export function categoriesFor(answers: Answers): Group[] {
  const has = (key: keyof Omit<Answers, "home">, value: string) =>
    answers[key].includes(value);
  const bills = [
    ...(answers.home === "rent" ? ["Rent"] : []),
    ...(answers.home === "own" ? ["Mortgage", "Home insurance"] : []),
    "Electric & gas",
    "Internet",
    "Phone",
    ...(has("travel", "car") ? ["Car insurance"] : []),
    ...(has("family", "kids") ? ["Childcare"] : []),
  ];
  const everyday = [
    "Groceries",
    "Dining out",
    ...(has("travel", "car") ? ["Gas & parking"] : []),
    ...(has("travel", "transit") ? ["Transit pass"] : []),
    "Household supplies",
    ...(has("family", "pets") ? ["Pet food"] : []),
  ];
  const irregular = [
    "Medical",
    "Gifts",
    "Clothing",
    "Annual subscriptions",
    ...(has("travel", "car") ? ["Car maintenance"] : []),
    ...(answers.home === "own" ? ["Home maintenance"] : []),
    ...(has("family", "pets") ? ["Vet"] : []),
    ...(has("family", "kids") ? ["Kids’ activities"] : []),
  ];
  const debt = [
    ...(has("debt", "student") ? ["Student loan payment"] : []),
    ...(has("debt", "auto") ? ["Car loan payment"] : []),
  ];
  const goals = [
    ...(has("goals", "emergency") ? ["Emergency fund"] : []),
    ...(has("goals", "vacation") ? ["Vacation"] : []),
    ...(has("goals", "home") ? ["Home down payment"] : []),
    ...(has("goals", "car") ? ["Next car"] : []),
  ];
  return [
    { name: "Bills", categories: bills },
    { name: "Everyday", categories: everyday },
    { name: "Irregular", categories: irregular },
    ...(debt.length ? [{ name: "Debt", categories: debt }] : []),
    ...(goals.length ? [{ name: "Savings goals", categories: goals }] : []),
    { name: "Just for fun", categories: ["Fun money", "Hobbies"] },
  ];
}

type Update = (change: Partial<CategoryDraft>) => void;

// The questions stack: answering the newest one reveals the next below it.
// Answered ones stay open, so a question that takes several answers can get
// more after the next appears.
export function CategoryQuestions({
  flow,
  update,
  answered,
  onAnswered,
  onDone,
  onSkip,
}: {
  flow: CategoryDraft;
  update: Update;
  // How many questions, from the top, have an answer.
  answered: number;
  onAnswered: (count: number) => void;
  onDone: () => void;
  onSkip: () => void;
}) {
  const id = useId();
  const still = useReducedMotion();
  const total = questions.length + 1;
  const shown = Math.min(answered + 1, total);
  // The last question brought into view, so each is scrolled to only once.
  const revealed = useRef(shown);
  // The draft starts from sample answers; a question shows none of them
  // until it's answered, and its first answer replaces them.
  const answer = (at: number, answers: Answers) => {
    update({ answers });
    if (at === answered) onAnswered(answered + 1);
  };
  const pick = (
    at: number,
    key: keyof Omit<Answers, "home">,
    value: string,
  ) => {
    const list = at < answered ? flow.answers[key] : [];
    answer(at, {
      ...flow.answers,
      [key]: list.includes(value)
        ? list.filter((item) => item !== value)
        : [...list, value],
    });
  };
  return (
    <>
      <Card>
        <div className={styles.questions}>
          {Array.from({ length: shown }, (_, at) => {
            const question = at > 0 ? questions[at - 1] : undefined;
            const done = at < answered;
            return (
              <motion.div
                key={at}
                ref={(node) => {
                  if (!node || at < revealed.current) return;
                  revealed.current = at + 1;
                  node.scrollIntoView({
                    block: "nearest",
                    behavior: still ? "auto" : "smooth",
                  });
                }}
                className={styles.question}
                data-answered={done || undefined}
                role="group"
                aria-labelledby={`${id}-${at}`}
                initial={at === 0 || still ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
              >
                <span id={`${id}-${at}`} className={styles.questionLabel}>
                  {question?.label ?? "Where do you live?"}
                </span>
                <div className={styles.answers}>
                  {question ? (
                    <>
                      {question.options.map(([value, label]) => (
                        <Button
                          key={value}
                          aria-pressed={
                            done && flow.answers[question.id].includes(value)
                          }
                          onClick={() => pick(at, question.id, value)}
                        >
                          {label}
                        </Button>
                      ))}
                      {question.none && (
                        <Button
                          aria-pressed={
                            done && flow.answers[question.id].length === 0
                          }
                          onClick={() =>
                            answer(at, { ...flow.answers, [question.id]: [] })
                          }
                        >
                          {question.none}
                        </Button>
                      )}
                    </>
                  ) : (
                    homes.map(([value, label]) => (
                      <Button
                        key={value}
                        aria-pressed={done && flow.answers.home === value}
                        onClick={() =>
                          answer(at, { ...flow.answers, home: value })
                        }
                      >
                        {label}
                      </Button>
                    ))
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </Card>
      <div className={batch.actions} data-end>
        <Button variant="quiet" onClick={onSkip}>
          Skip for now
        </Button>
        {answered >= total && (
          <Button variant="primary" onClick={onDone}>
            See my categories
            <ChevronRightIcon aria-hidden />
          </Button>
        )}
      </div>
    </>
  );
}

const homes = [
  ["rent", "I rent"],
  ["own", "I own"],
  ["neither", "Neither"],
] as const;

// The groups the answers produce, laid out like the plan: a header per group
// and a row per category, each with a box to keep or drop it.
export function CategoryReview({
  flow,
  update,
}: {
  flow: CategoryDraft;
  update: Update;
}) {
  const [draft, setDraft] = useState("");
  const [closed, setClosed] = useState<string[]>([]);
  const groups = categoriesFor(flow.answers);
  if (flow.custom.length)
    groups.push({ name: "Your own", categories: flow.custom });
  const kept = (name: string) => !flow.unchecked.includes(name);
  const keep = (names: string[], on: boolean) =>
    update({
      unchecked: on
        ? flow.unchecked.filter((item) => !names.includes(item))
        : [...new Set([...flow.unchecked, ...names])],
    });
  const addCustom = () => {
    const name = draft.trim();
    if (!name) return;
    if (!groups.some((group) => group.categories.includes(name)))
      update({ custom: [...flow.custom, name] });
    else keep([name], true);
    setDraft("");
  };

  return (
    <div className={styles.reviewPanel}>
      <div className={styles.review}>
        {groups.map((group) => {
          const count = group.categories.filter(kept).length;
          const open = !closed.includes(group.name);
          return (
            <div key={group.name} className={styles.reviewGroup}>
              <div className={styles.reviewHeader}>
                <label className={styles.reviewCheck}>
                  <Checkbox
                    aria-label={`Keep all of ${group.name}`}
                    checked={
                      count === 0
                        ? false
                        : count === group.categories.length
                          ? true
                          : "indeterminate"
                    }
                    onCheckedChange={() =>
                      keep(group.categories, count < group.categories.length)
                    }
                  />
                </label>
                <button
                  type="button"
                  className={styles.reviewToggle}
                  aria-expanded={open}
                  onClick={() =>
                    setClosed(
                      open
                        ? [...closed, group.name]
                        : closed.filter((name) => name !== group.name),
                    )
                  }
                >
                  <ChevronDownIcon
                    size={12}
                    strokeWidth={2.5}
                    className={styles.reviewCaret}
                    aria-hidden
                  />
                  {group.name}
                </button>
                <span className={styles.reviewCount}>
                  {count} of {group.categories.length}
                </span>
              </div>
              {open && (
                <ul className={styles.reviewRows}>
                  {group.categories.map((name) => (
                    <li key={name}>
                      <label
                        className={styles.reviewRow}
                        data-dropped={!kept(name) || undefined}
                      >
                        <span className={styles.reviewCheck}>
                          <Checkbox
                            checked={kept(name)}
                            onCheckedChange={(on) => keep([name], on === true)}
                          />
                        </span>
                        {name}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <form
        className={styles.addRow}
        data-review
        onSubmit={(event) => {
          event.preventDefault();
          addCustom();
        }}
      >
        <Field label="Category name" labelHidden>
          <TextInput
            value={draft}
            placeholder="Add your own, like Climbing gym"
            maxLength={80}
            onChange={setDraft}
          />
        </Field>
        <Button type="submit" disabled={!draft.trim()}>
          <PlusIcon aria-hidden />
          Add
        </Button>
      </form>
    </div>
  );
}
