"use client";
import { useId, useState, type ReactNode } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
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
  },
  {
    id: "debt",
    label: "Any debt you’re paying down?",
    options: [
      ["card", "Credit card"],
      ["student", "Student loan"],
      ["auto", "Car loan"],
    ],
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
  },
];

export type Group = { name: string; categories: string[]; note?: string };

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
    {
      name: "Irregular",
      categories: irregular,
      note: "Costs that don’t come monthly. Setting a little aside each month keeps them from becoming emergencies.",
    },
    ...(debt.length
      ? [
          {
            name: "Debt",
            categories: debt,
            note: "Adding the loan itself later pairs it with its payment category.",
          },
        ]
      : []),
    ...(goals.length ? [{ name: "Savings goals", categories: goals }] : []),
    { name: "Just for fun", categories: ["Fun money", "Hobbies"] },
  ];
}

export function CategoriesPanel({
  flow,
  update,
}: {
  flow: CategoryDraft;
  update: (change: Partial<CategoryDraft>) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const groups = categoriesFor(flow.answers);
  const setAnswer = (key: keyof Omit<Answers, "home">, value: string) => {
    const list = flow.answers[key];
    update({
      answers: {
        ...flow.answers,
        [key]: list.includes(value)
          ? list.filter((item) => item !== value)
          : [...list, value],
      },
    });
  };
  const toggle = (name: string, on: boolean) =>
    update({
      unchecked: on
        ? flow.unchecked.filter((item) => item !== name)
        : [...flow.unchecked, name],
    });
  const addCustom = () => {
    const name = draft.trim();
    if (!name) return;
    update({ custom: [...flow.custom, name] });
    setDraft("");
  };

  return (
    <div className={styles.categories}>
      <Card>
        <div className={styles.questions}>
          <Question label="Where do you live?">
            {(
              [
                ["rent", "I rent"],
                ["own", "I own"],
                ["neither", "Neither"],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                aria-pressed={flow.answers.home === value}
                onClick={() =>
                  update({ answers: { ...flow.answers, home: value } })
                }
              >
                {label}
              </Button>
            ))}
          </Question>
          {questions.map((question) => (
            <Question key={question.id} label={question.label}>
              {question.options.map(([value, label]) => (
                <Button
                  key={value}
                  size="sm"
                  aria-pressed={flow.answers[question.id].includes(value)}
                  onClick={() => setAnswer(question.id, value)}
                >
                  {label}
                </Button>
              ))}
            </Question>
          ))}
          {flow.answers.debt.includes("card") && (
            <p className={batch.fieldHint}>
              Credit card payments get their own category when you add the card,
              so it isn’t listed here.
            </p>
          )}
        </div>
      </Card>

      <Card>
        <div
          className={styles.groups}
          aria-label="Categories to add"
          role="group"
        >
          {groups.map((group) => (
            <div key={group.name} className={styles.group}>
              <h2 className={styles.groupName}>{group.name}</h2>
              {group.note && <p className={batch.fieldHint}>{group.note}</p>}
              <ul className={styles.checkList}>
                {group.categories.map((name) => (
                  <li key={name}>
                    <label className={styles.check}>
                      <Checkbox
                        checked={!flow.unchecked.includes(name)}
                        onCheckedChange={(on) => toggle(name, on === true)}
                      />
                      {name}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {flow.custom.length > 0 && (
            <div className={styles.group}>
              <h2 className={styles.groupName}>Your own</h2>
              <ul className={styles.checkList}>
                {flow.custom.map((name, index) => (
                  <li key={`${name}-${index}`}>
                    <label className={styles.check}>
                      <Checkbox
                        checked
                        onCheckedChange={() =>
                          update({
                            custom: flow.custom.filter((_, at) => at !== index),
                          })
                        }
                      />
                      {name}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className={styles.divider} />
        <div className={styles.addRow}>
          <label className="sr-only" htmlFor={`${id}-custom`}>
            Category name
          </label>
          <input
            id={`${id}-custom`}
            className={batch.input}
            value={draft}
            placeholder="Add your own, like Climbing gym"
            maxLength={80}
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addCustom();
              }
            }}
          />
          <Button disabled={!draft.trim()} onClick={addCustom}>
            <PlusIcon aria-hidden />
            Add
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Question({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className={styles.question} role="group" aria-labelledby={id}>
      <span id={id} className={styles.questionLabel}>
        {label}
      </span>
      <div className={styles.answers}>{children}</div>
    </div>
  );
}
