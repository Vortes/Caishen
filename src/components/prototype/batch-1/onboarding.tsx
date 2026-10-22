"use client";

import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleIcon,
  LandmarkIcon,
  PlusIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { Switch } from "~/components/ui/switch";
import { Tag } from "~/components/ui/tag";
import { Brand } from "./brand";
import {
  CodeDisplay,
  CodeField,
  codeError,
  isComplete,
  useLock,
  type CodeResult,
} from "./invite-code";
import {
  chaseAccounts,
  detectedTimezone,
  me,
  money,
  myInviteCode,
  partner,
  timezoneCity,
  timezones,
} from "./mock";
import {
  Choice,
  PrototypeBar,
  PrototypePage,
  useNotice,
  useStored,
  useTheme,
} from "./prototype";
import { WELCOME_PATH } from "./routes";
import batch from "./batch.module.css";
import styles from "./onboarding.module.css";

// The variable the pacing variants move: whether setup is a fixed sequence
// of steps (YNAB's original web onboarding) or one required step and then a
// checklist done in any order (YNAB's 2025 "at your own pace" checklist).
type Pacing = "guided" | "checklist";
// The variable the category variants move: whether categories come from a
// few questions about the user's life (YNAB's personalization quiz) or from
// a starter list to trim.
type CategorySource = "questions" | "list";

type Outcome = "succeeds" | "fails";
type InviteOutcome = Exclude<CodeResult, "own">;
type BankOutcome = "connects" | "cancelled" | "fails";

type Stage = "basics" | "categories" | "accounts" | "ready";
type Item = "categories" | "accounts" | "partner";

type Answers = {
  home: "rent" | "own" | "neither";
  travel: string[];
  family: string[];
  debt: string[];
  goals: string[];
};

type Account = {
  id: string;
  name: string;
  detail: string;
  balance: number;
  kind: "cash" | "credit";
};

type Flow = {
  stage: Stage;
  open: Item | null;
  name: string;
  timezone: string;
  email: boolean;
  codeOpen: boolean;
  code: string;
  codeChecked: boolean;
  joined: boolean;
  answers: Answers;
  unchecked: string[];
  custom: string[];
  categoriesDone: boolean;
  accounts: Account[];
  accountsDone: boolean;
  inviteCreated: boolean;
};

const initialFlow: Flow = {
  stage: "basics",
  open: null,
  name: me.budgetName,
  timezone: detectedTimezone,
  email: true,
  codeOpen: false,
  code: "",
  codeChecked: false,
  joined: false,
  answers: {
    home: "rent",
    travel: ["car"],
    family: [],
    debt: ["card"],
    goals: ["emergency"],
  },
  unchecked: [],
  custom: [],
  categoriesDone: false,
  accounts: [],
  accountsDone: false,
  inviteCreated: false,
};

const steps: { id: Stage; label: string }[] = [
  { id: "basics", label: "Your budget" },
  { id: "categories", label: "Categories" },
  { id: "accounts", label: "Accounts" },
  { id: "ready", label: "Ready" },
];

// Its own page, before the app shell: the shell only loads once a budget
// exists. Lives at app.curate.is/welcome after sign-up.
export function OnboardingPrototype() {
  const [theme, setTheme] = useTheme();
  const [pacing, setPacing] = useStored<Pacing>("onboarding.pacing", "guided");
  const [source, setSource] = useStored<CategorySource>(
    "onboarding.categories",
    "questions",
  );
  const [create, setCreate] = useStored<Outcome>(
    "onboarding.create",
    "succeeds",
  );
  const [codeOutcome, setCodeOutcome] = useStored<InviteOutcome>(
    "onboarding.invite",
    "valid",
  );
  const [bank, setBank] = useStored<BankOutcome>("onboarding.bank", "connects");
  const [flow, setFlow] = useStored<Flow>("onboarding.flow", initialFlow);
  const update = (change: Partial<Flow>) =>
    setFlow((current) => ({ ...current, ...change }));
  const notice = useNotice();
  const heading = useRef<HTMLHeadingElement>(null);

  // Each step change moves focus to its heading, so keyboard and screen
  // reader users start at the top of the new step.
  const goTo = (stage: Stage) => {
    update({ stage });
    requestAnimationFrame(() => heading.current?.focus());
  };

  const created = flow.stage !== "basics";
  const stepIndex = steps.findIndex((step) => step.id === flow.stage);

  return (
    <PrototypePage
      theme={theme}
      controls={
        <PrototypeBar title="Onboarding" theme={theme} onTheme={setTheme}>
          <Choice
            label="Variant: pacing"
            value={pacing}
            options={[
              ["guided", "Guided steps"],
              ["checklist", "Checklist"],
            ]}
            onChange={(next) => {
              setPacing(next);
              if (created)
                update({ stage: next === "guided" ? "categories" : "ready" });
            }}
          />
          <Choice
            label="Variant: categories from"
            value={source}
            options={[
              ["questions", "A few questions"],
              ["list", "A starter list"],
            ]}
            onChange={setSource}
          />
          <Choice
            label="Creating the budget"
            value={create}
            options={[
              ["succeeds", "Succeeds"],
              ["fails", "Fails"],
            ]}
            onChange={setCreate}
          />
          <Choice
            label="Partner’s code"
            value={codeOutcome}
            options={[
              ["valid", "Valid"],
              ["expired", "Expired"],
              ["used", "Already used"],
              ["full", "Partner already has one"],
              ["invalid", "No match"],
              ["rate-limited", "Too many tries"],
            ]}
            onChange={setCodeOutcome}
          />
          <Choice
            label="Connecting a bank"
            value={bank}
            options={[
              ["connects", "Connects"],
              ["cancelled", "Closed Plaid"],
              ["fails", "Fails"],
            ]}
            onChange={setBank}
          />
        </PrototypeBar>
      }
    >
      <div className={styles.frame}>
        <header className={styles.header}>
          <a href={WELCOME_PATH} className={styles.brandLink}>
            <Brand />
          </a>
          <div className={styles.account}>
            <span>{me.email}</span>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => notice.show("Signs out and returns to curate.is")}
            >
              Sign out
            </Button>
          </div>
        </header>

        <main className={styles.main}>
          {pacing === "guided" && (
            <ol className={styles.stepper} aria-label="Setup steps">
              {steps.map((step, index) => (
                <li
                  key={step.id}
                  data-state={
                    index < stepIndex
                      ? "done"
                      : index === stepIndex
                        ? "current"
                        : undefined
                  }
                  aria-current={index === stepIndex ? "step" : undefined}
                >
                  {index < stepIndex ? (
                    <CheckIcon size={12} aria-hidden />
                  ) : (
                    <span className={styles.stepNumber} aria-hidden>
                      {index + 1}
                    </span>
                  )}
                  {step.label}
                </li>
              ))}
            </ol>
          )}

          {flow.stage === "basics" && (
            <BasicsStep
              heading={heading}
              flow={flow}
              update={update}
              createOutcome={create}
              codeOutcome={codeOutcome}
              onCreated={() =>
                goTo(pacing === "guided" ? "categories" : "ready")
              }
            />
          )}

          {pacing === "guided" && flow.stage === "categories" && (
            <Step
              heading={heading}
              title="Choose your categories"
              lede={
                source === "questions"
                  ? "A few questions about your life give you a starting set. Every category can be renamed, moved, or removed later."
                  : "Start from the categories most budgets need. Uncheck what doesn’t fit; you can add, rename, or remove any later."
              }
              footer={
                <>
                  <Button variant="quiet" onClick={() => goTo("accounts")}>
                    Skip for now
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      update({ categoriesDone: true });
                      goTo("accounts");
                    }}
                  >
                    Add {categoryCount(flow, source)} categories
                  </Button>
                </>
              }
            >
              <CategoriesPanel flow={flow} update={update} source={source} />
            </Step>
          )}

          {pacing === "guided" && flow.stage === "accounts" && (
            <Step
              heading={heading}
              title="Add the accounts you spend from"
              lede="Start with checking and the cards you use. Each starts at today’s balance, and that cash is what you’ll assign. Savings and others can wait."
              back={() => goTo("categories")}
              footer={
                <>
                  <Button variant="quiet" onClick={() => goTo("ready")}>
                    {flow.accounts.length ? "Done" : "Skip for now"}
                  </Button>
                  {flow.accounts.length > 0 && (
                    <Button
                      variant="primary"
                      onClick={() => {
                        update({ accountsDone: true });
                        goTo("ready");
                      }}
                    >
                      Continue
                    </Button>
                  )}
                </>
              }
            >
              <AccountsPanel flow={flow} update={update} outcome={bank} />
            </Step>
          )}

          {flow.stage === "ready" &&
            (pacing === "guided" ? (
              <ReadyStep
                heading={heading}
                flow={flow}
                source={source}
                update={update}
                onOpen={() =>
                  notice.show(
                    "Opens the plan with Assign money open on Ready to Assign",
                  )
                }
              />
            ) : (
              <Checklist
                heading={heading}
                flow={flow}
                update={update}
                source={source}
                bank={bank}
                onOpen={() =>
                  notice.show(
                    "Opens the plan. The checklist stays in the sidebar until it’s done or dismissed",
                  )
                }
              />
            ))}
        </main>
      </div>
      {notice.region}
    </PrototypePage>
  );
}

function Step({
  heading,
  title,
  lede,
  back,
  footer,
  children,
}: {
  heading: React.RefObject<HTMLHeadingElement | null>;
  title: string;
  lede: string;
  back?: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.step} aria-labelledby="step-title">
      <div className={styles.stepIntro}>
        {back && (
          <div>
            <Button size="sm" variant="quiet" onClick={back}>
              <ArrowLeftIcon aria-hidden />
              Back
            </Button>
          </div>
        )}
        <h1
          id="step-title"
          ref={heading}
          tabIndex={-1}
          className={styles.title}
        >
          {title}
        </h1>
        <p className={styles.lede}>{lede}</p>
      </div>
      {children}
      {footer && <div className={styles.stepFooter}>{footer}</div>}
    </section>
  );
}

// ---------- Step 1: the budget itself ----------

function BasicsStep({
  heading,
  flow,
  update,
  createOutcome,
  codeOutcome,
  onCreated,
}: {
  heading: React.RefObject<HTMLHeadingElement | null>;
  flow: Flow;
  update: (change: Partial<Flow>) => void;
  createOutcome: Outcome;
  codeOutcome: InviteOutcome;
  onCreated: () => void;
}) {
  const id = useId();
  const [nameError, setNameError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const joining = flow.codeChecked;

  const submit = () => {
    if (!flow.name.trim()) {
      setNameError("Give your budget a name.");
      return;
    }
    setNameError(null);
    setCreating(true);
    setCreateError(null);
    window.setTimeout(() => {
      setCreating(false);
      if (createOutcome === "fails") {
        setCreateError(
          joining
            ? "Your budget couldn’t be created, so you haven’t joined yet. Check your connection, then try again."
            : "Your budget couldn’t be created. Check your connection, then try again.",
        );
        return;
      }
      update({ joined: joining });
      onCreated();
    }, 900);
  };

  return (
    <Step
      heading={heading}
      title={
        joining
          ? `Welcome, ${me.firstName}. ${partner.fullName} invited you.`
          : `Welcome, ${me.firstName}. Let’s set up your budget.`
      }
      lede={
        joining
          ? `First, set up your own budget. It stays yours: ${partner.firstName} sees only the categories you share and who owes whom.`
          : "Your budget plans the money you have today. It’s yours alone; a partner gets their own and sees only what you share."
      }
    >
      <form
        className={styles.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {joining && (
          <Invitation
            code={flow.code}
            onChange={() => update({ codeChecked: false })}
          />
        )}
        <Card>
          <div className={styles.fields}>
            <div className={batch.field}>
              <label className={batch.fieldLabel} htmlFor={`${id}-name`}>
                Budget name
              </label>
              <input
                id={`${id}-name`}
                className={batch.input}
                value={flow.name}
                maxLength={80}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={Boolean(nameError)}
                aria-describedby={nameError ? `${id}-name-error` : undefined}
                onChange={(event) => update({ name: event.target.value })}
              />
              {nameError && (
                <span
                  id={`${id}-name-error`}
                  className={batch.error}
                  role="alert"
                >
                  <CircleAlertIcon size={13} aria-hidden />
                  {nameError}
                </span>
              )}
            </div>
            <div className={batch.field}>
              <label className={batch.fieldLabel} htmlFor={`${id}-zone`}>
                Timezone
              </label>
              <select
                id={`${id}-zone`}
                className={batch.select}
                value={flow.timezone}
                aria-describedby={`${id}-zone-hint`}
                onChange={(event) => update({ timezone: event.target.value })}
              >
                {timezones.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.label}
                  </option>
                ))}
              </select>
              <span id={`${id}-zone-hint`} className={batch.fieldHint}>
                {flow.timezone === detectedTimezone
                  ? "From this browser. "
                  : ""}
                Decides when a new month starts and when your daily email
                arrives.
              </span>
            </div>
          </div>
          <div className={styles.divider} />
          <label className={styles.switchRow}>
            <span className={styles.switchText}>
              <span className={styles.switchLabel}>Daily review email</span>
              <span className={batch.fieldHint}>
                Each morning at 8 a.m. {timezoneCity(flow.timezone)} time, what
                needs a look. To {me.email}; change the hour in Settings.
              </span>
            </span>
            <Switch
              checked={flow.email}
              onCheckedChange={(email) => update({ email })}
            />
          </label>
          <div className={styles.divider} />
          <p className={styles.currency}>Amounts are in US dollars.</p>
        </Card>

        {!joining && (
          <PartnerCode flow={flow} update={update} outcome={codeOutcome} />
        )}

        {createError && (
          <p className={batch.error} role="alert">
            <CircleAlertIcon size={13} aria-hidden />
            {createError}
          </p>
        )}
        <div className={styles.stepFooter}>
          <Button variant="primary" type="submit" disabled={creating}>
            {creating
              ? joining
                ? "Creating and joining…"
                : "Creating your budget…"
              : joining
                ? `Create budget and join ${partner.firstName}`
                : "Create budget"}
          </Button>
        </div>
      </form>
    </Step>
  );
}

// Who the code belongs to, once the server has looked it up: the inviter's
// name and photo, never their email or anything in their budget.
function Invitation({
  code,
  onChange,
}: {
  code: string;
  onChange: () => void;
}) {
  return (
    <Card>
      <div className={styles.invitation}>
        <span className={styles.avatar} data-size="large" aria-hidden>
          J
        </span>
        <span className={styles.switchText}>
          <span className={styles.switchLabel}>
            {partner.fullName} invited you to share expenses
          </span>
          <span className={batch.fieldHint}>
            Code {code} · expires today at 9:41 p.m.
          </span>
        </span>
        <Button size="sm" variant="quiet" onClick={onChange}>
          Use a different code
        </Button>
      </div>
    </Card>
  );
}

// Most people start alone; the person a partner invited opens this. Their
// budget is still created first, then joined to the partner's household.
function PartnerCode({
  flow,
  update,
  outcome,
}: {
  flow: Flow;
  update: (change: Partial<Flow>) => void;
  outcome: InviteOutcome;
}) {
  const id = useId();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CodeResult | null>(null);
  const [incomplete, setIncomplete] = useState(false);
  const locked = useLock(result === "rate-limited");
  const error = incomplete
    ? "Enter all 8 characters."
    : result
      ? codeError(result, flow.code)
      : null;

  const check = () => {
    if (!isComplete(flow.code)) return setIncomplete(true);
    setIncomplete(false);
    setChecking(true);
    setResult(null);
    window.setTimeout(() => {
      setChecking(false);
      if (outcome === "valid") update({ codeChecked: true });
      else setResult(outcome);
    }, 700);
  };

  if (!flow.codeOpen)
    return (
      <div>
        <Button variant="quiet" onClick={() => update({ codeOpen: true })}>
          Have a code from your partner?
        </Button>
      </div>
    );
  return (
    <Card>
      <div className={styles.codeHead}>
        <div className={styles.switchText}>
          <span className={styles.switchLabel}>Join your partner</span>
          <span className={batch.fieldHint}>
            You still get your own private budget. Shared categories and who
            owes whom are the only things you both see.
          </span>
        </div>
        <Button
          size="sm"
          variant="quiet"
          onClick={() => update({ codeOpen: false, code: "" })}
        >
          Cancel
        </Button>
      </div>
      <div className={styles.codeField}>
        <CodeField
          id={`${id}-code`}
          label="Invitation code"
          value={flow.code}
          error={error}
          locked={locked}
          onChange={(code) => {
            update({ code });
            setIncomplete(false);
            if (result !== "rate-limited") setResult(null);
          }}
          action={
            <Button disabled={checking || Boolean(locked)} onClick={check}>
              {checking ? "Checking…" : "Check code"}
            </Button>
          }
        />
      </div>
    </Card>
  );
}

// ---------- Categories ----------

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

type Group = { name: string; categories: string[]; note?: string };

// The starting groups the answers produce, in the order the plan shows them.
function categoriesFor(answers: Answers, source: CategorySource): Group[] {
  const all = source === "list";
  const has = (key: keyof Omit<Answers, "home">, value: string) =>
    all || answers[key].includes(value);
  const bills = [
    ...(all || answers.home === "rent" ? ["Rent"] : []),
    ...(!all && answers.home === "own" ? ["Mortgage", "Home insurance"] : []),
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
    ...(answers.home === "own" && !all ? ["Home maintenance"] : []),
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

function categoryCount(flow: Flow, source: CategorySource) {
  return (
    categoriesFor(flow.answers, source)
      .flatMap((group) => group.categories)
      .filter((name) => !flow.unchecked.includes(name)).length +
    flow.custom.length
  );
}

function CategoriesPanel({
  flow,
  update,
  source,
}: {
  flow: Flow;
  update: (change: Partial<Flow>) => void;
  source: CategorySource;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const groups = categoriesFor(flow.answers, source);
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
      {source === "questions" && (
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
                Credit card payments get their own category when you add the
                card, so it isn’t listed here.
              </p>
            )}
          </div>
        </Card>
      )}

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

// ---------- Accounts ----------

type BankPhase = "idle" | "plaid" | "saving" | "found" | "cancelled" | "failed";

function AccountsPanel({
  flow,
  update,
  outcome,
}: {
  flow: Flow;
  update: (change: Partial<Flow>) => void;
  outcome: BankOutcome;
}) {
  const [phase, setPhase] = useState<BankPhase>("idle");
  const [picked, setPicked] = useState<string[]>(["chk", "sav", "csp"]);
  const [manual, setManual] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const connect = () => {
    setPhase("plaid");
    timer.current = window.setTimeout(() => {
      if (outcome === "cancelled") return setPhase("cancelled");
      if (outcome === "fails") return setPhase("failed");
      setPhase("saving");
      timer.current = window.setTimeout(() => setPhase("found"), 1100);
    }, 1400);
  };

  const addPicked = () => {
    const added = chaseAccounts
      .filter((account) => account.kind && picked.includes(account.id))
      .map<Account>((account) => ({
        id: `chase-${account.id}`,
        name: `Chase ${account.name}`,
        detail: `Chase ••${account.mask}`,
        balance: account.balance,
        kind: account.kind!,
      }));
    update({
      accounts: [
        ...flow.accounts.filter((account) => !account.id.startsWith("chase-")),
        ...added,
      ],
    });
    setPhase("idle");
  };

  const linked = flow.accounts.some((account) =>
    account.id.startsWith("chase-"),
  );

  return (
    <div className={styles.accounts}>
      {flow.accounts.length > 0 && (
        <Card>
          <ul
            className={styles.accountList}
            aria-label="Accounts in your budget"
          >
            {flow.accounts.map((account) => (
              <li key={account.id} className={styles.accountRow}>
                <CircleCheckIcon
                  size={14}
                  className={styles.done}
                  aria-hidden
                />
                <span className={styles.switchText}>
                  <span className={styles.switchLabel}>{account.name}</span>
                  <span className={batch.fieldHint}>
                    {account.kind === "cash" ? "Cash" : "Credit"} ·{" "}
                    {account.detail}
                  </span>
                </span>
                <span className={styles.amount}>{money(account.balance)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {phase === "found" ? (
        <Card>
          <div className={styles.bankHead}>
            <span className={styles.switchLabel}>Chase found 4 accounts</span>
            <span className={batch.fieldHint}>
              Checking and savings go in Cash, credit cards in Credit.
            </span>
          </div>
          <ul className={styles.checkList} data-rows>
            {chaseAccounts.map((account) => (
              <li key={account.id}>
                <label
                  className={styles.bankRow}
                  data-disabled={!account.kind || undefined}
                >
                  <Checkbox
                    disabled={!account.kind}
                    checked={
                      Boolean(account.kind) && picked.includes(account.id)
                    }
                    onCheckedChange={(on) =>
                      setPicked((current) =>
                        on === true
                          ? [...current, account.id]
                          : current.filter((item) => item !== account.id),
                      )
                    }
                  />
                  <span className={styles.switchText}>
                    <span>
                      {account.name}{" "}
                      <span className={styles.mask}>••{account.mask}</span>
                    </span>
                    <span className={batch.fieldHint}>
                      {account.kind === "cash"
                        ? "Cash"
                        : account.kind === "credit"
                          ? "Credit"
                          : account.reason}
                    </span>
                  </span>
                  <span className={styles.amount}>
                    {account.kind ? money(account.balance) : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className={styles.divider} />
          <div className={batch.actions} data-end>
            <Button onClick={() => setPhase("idle")}>Not now</Button>
            <Button
              variant="primary"
              disabled={!picked.length}
              onClick={addPicked}
            >
              Add {picked.length} {picked.length === 1 ? "account" : "accounts"}
            </Button>
          </div>
        </Card>
      ) : (
        <Card>
          <div className={styles.connect}>
            <LandmarkIcon
              size={15}
              className={styles.connectIcon}
              aria-hidden
            />
            <span className={styles.switchText}>
              <span className={styles.switchLabel}>
                {linked ? "Connect another bank" : "Connect your bank"}
              </span>
              <span className={batch.fieldHint}>
                Through Plaid. Balances and new activity arrive each morning for
                you to review. Your bank password stays with Plaid.
              </span>
            </span>
            {phase === "idle" || phase === "cancelled" || phase === "failed" ? (
              <Button
                variant={linked ? "secondary" : "primary"}
                onClick={connect}
              >
                {phase === "failed" ? "Try again" : "Connect"}
              </Button>
            ) : null}
          </div>
          {(phase === "plaid" || phase === "saving") && (
            <div className={styles.bankProgress} role="status">
              <span className={batch.fieldHint}>
                {phase === "plaid"
                  ? "Continue in the Plaid window. If your bank opens its own site, you’ll come back here."
                  : "Saving your connection and fetching accounts…"}
              </span>
              <div className={batch.progress} aria-hidden />
            </div>
          )}
          {phase === "cancelled" && (
            <p className={styles.bankNote} role="status">
              Plaid closed before your bank connected. Nothing was saved.
            </p>
          )}
          {phase === "failed" && (
            <p className={`${batch.error} ${styles.bankNote}`} role="alert">
              <CircleAlertIcon size={13} aria-hidden />
              Chase didn’t finish connecting. Try again, or add the account by
              hand and connect it later.
            </p>
          )}
        </Card>
      )}

      {manual ? (
        <ManualAccount
          onAdd={(account) => {
            update({ accounts: [...flow.accounts, account] });
            setManual(false);
          }}
          onCancel={() => setManual(false)}
        />
      ) : (
        <div>
          <Button variant="quiet" onClick={() => setManual(true)}>
            <PlusIcon aria-hidden />
            Add an account by hand
          </Button>
        </div>
      )}
    </div>
  );
}

function ManualAccount({
  onAdd,
  onCancel,
}: {
  onAdd: (account: Account) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [type, setType] = useState("checking");
  const [balance, setBalance] = useState("");
  const [error, setError] = useState<string | null>(null);
  const credit = type === "credit";

  const submit = () => {
    const cents = Math.round(Number(balance.replace(/[$,\s]/g, "")) * 100);
    if (!name.trim()) return setError("Name the account, like Checking.");
    if (!balance.trim() || Number.isNaN(cents))
      return setError("Enter today’s balance, like 1,250.00.");
    onAdd({
      id: `manual-${Date.now()}`,
      name: name.trim(),
      detail: "Added by hand",
      balance: credit ? -Math.abs(cents) : cents,
      kind: credit ? "credit" : "cash",
    });
  };

  return (
    <Card>
      <form
        className={styles.manual}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className={styles.manualFields}>
          <div className={batch.field}>
            <label className={batch.fieldLabel} htmlFor={`${id}-name`}>
              Account name
            </label>
            <input
              id={`${id}-name`}
              className={batch.input}
              value={name}
              placeholder="Credit union checking"
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className={batch.field}>
            <label className={batch.fieldLabel} htmlFor={`${id}-type`}>
              Type
            </label>
            <select
              id={`${id}-type`}
              className={batch.select}
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              <option value="checking">Checking</option>
              <option value="savings">Savings</option>
              <option value="cash">Cash</option>
              <option value="credit">Credit card</option>
            </select>
          </div>
          <div className={batch.field}>
            <label className={batch.fieldLabel} htmlFor={`${id}-balance`}>
              {credit ? "Amount owed today" : "Balance today"}
            </label>
            <input
              id={`${id}-balance`}
              className={`${batch.input} ${styles.amountInput}`}
              value={balance}
              inputMode="decimal"
              placeholder="0.00"
              autoComplete="off"
              onChange={(event) => setBalance(event.target.value)}
            />
          </div>
        </div>
        {error && (
          <p className={batch.error} role="alert">
            <CircleAlertIcon size={13} aria-hidden />
            {error}
          </p>
        )}
        <div className={batch.actions} data-end>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" type="submit">
            Add account
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ---------- Ready ----------

function readyToAssign(flow: Flow) {
  return flow.accounts
    .filter((account) => account.kind === "cash")
    .reduce((sum, account) => sum + account.balance, 0);
}

function Summary({ flow }: { flow: Flow }) {
  const cash = flow.accounts.filter((account) => account.kind === "cash");
  const cards = flow.accounts.filter((account) => account.kind === "credit");
  const ready = readyToAssign(flow);
  return (
    <Card>
      <div className={styles.figure}>
        <span className={batch.fieldHint}>Ready to Assign</span>
        <strong data-empty={!ready || undefined}>{money(ready)}</strong>
      </div>
      <p className={styles.summaryText}>
        {cash.length
          ? `The cash in ${cash.map((account) => account.name).join(" and ")}. Next, give every dollar a job: the bills due before your next paycheck first.`
          : "Add a checking account to see the cash you have to assign. Until then, your plan starts at $0.00."}
      </p>
      {cards.map((card) => (
        <p key={card.id} className={styles.summaryText}>
          {card.name} owes {money(-card.balance)}. Its payment category starts
          short by that much, so you can plan to pay it down.
        </p>
      ))}
    </Card>
  );
}

function ReadyStep({
  heading,
  flow,
  source,
  update,
  onOpen,
}: {
  heading: React.RefObject<HTMLHeadingElement | null>;
  flow: Flow;
  source: CategorySource;
  update: (change: Partial<Flow>) => void;
  onOpen: () => void;
}) {
  return (
    <Step
      heading={heading}
      title="Your budget is ready"
      lede={`${flow.name} has ${categoryCount(flow, source)} categories and ${flow.accounts.length} ${flow.accounts.length === 1 ? "account" : "accounts"}. Everything here can change later in the plan and Settings.`}
      footer={
        <Button variant="primary" onClick={onOpen}>
          Open my budget
          <ChevronRightIcon aria-hidden />
        </Button>
      }
    >
      <Summary flow={flow} />
      <PartnerPanel flow={flow} update={update} />
    </Step>
  );
}

function PartnerPanel({
  flow,
  update,
}: {
  flow: Flow;
  update: (change: Partial<Flow>) => void;
}) {
  if (flow.joined)
    return (
      <Card>
        <div className={styles.invitedBy}>
          <span className={styles.avatar} aria-hidden>
            J
          </span>
          <span className={styles.switchText}>
            <span className={styles.switchLabel}>
              Connected with {partner.fullName}
            </span>
            <span className={batch.fieldHint}>
              To split a category like rent, open it in the plan and share it.
            </span>
          </span>
        </div>
      </Card>
    );
  return (
    <Card>
      <div className={styles.codeHead}>
        <span className={styles.switchText}>
          <span className={styles.switchLabel}>Budgeting with a partner?</span>
          <span className={batch.fieldHint}>
            Send them a code to enter when they sign up. You can also do this
            later in Settings.
          </span>
        </span>
        {!flow.inviteCreated && (
          <Button onClick={() => update({ inviteCreated: true })}>
            Create code
          </Button>
        )}
      </div>
      {flow.inviteCreated && (
        <CodeDisplay code={myInviteCode} expires="tomorrow at 9:41 a.m." />
      )}
    </Card>
  );
}

// ---------- Checklist pacing ----------

function Checklist({
  heading,
  flow,
  update,
  source,
  bank,
  onOpen,
}: {
  heading: React.RefObject<HTMLHeadingElement | null>;
  flow: Flow;
  update: (change: Partial<Flow>) => void;
  source: CategorySource;
  bank: BankOutcome;
  onOpen: () => void;
}) {
  const items: {
    id: Item;
    title: string;
    hint: string;
    done: boolean;
    optional?: boolean;
    content: ReactNode;
    finish?: ReactNode;
  }[] = [
    {
      id: "categories",
      title: "Choose your categories",
      hint: flow.categoriesDone
        ? `${categoryCount(flow, source)} categories added`
        : "A few questions give you a starting set",
      done: flow.categoriesDone,
      content: <CategoriesPanel flow={flow} update={update} source={source} />,
      finish: (
        <Button
          variant="primary"
          onClick={() => update({ categoriesDone: true, open: null })}
        >
          Add {categoryCount(flow, source)} categories
        </Button>
      ),
    },
    {
      id: "accounts",
      title: "Add your accounts",
      hint: flow.accounts.length
        ? `${flow.accounts.length} added · ${money(readyToAssign(flow))} to assign`
        : "Connect your bank, or add balances by hand",
      done: flow.accountsDone,
      content: <AccountsPanel flow={flow} update={update} outcome={bank} />,
      finish: flow.accounts.length ? (
        <Button
          variant="primary"
          onClick={() => update({ accountsDone: true, open: null })}
        >
          Done
        </Button>
      ) : null,
    },
    {
      id: "partner",
      title: flow.joined
        ? `Connected with ${partner.fullName}`
        : "Invite your partner",
      hint: flow.joined
        ? "Share a category from the plan to split it"
        : flow.inviteCreated
          ? "Code created · works once, for 24 hours"
          : "Split rent and groceries, keep the rest private",
      done: flow.joined || flow.inviteCreated,
      optional: !flow.joined,
      content: <PartnerPanel flow={flow} update={update} />,
    },
  ];
  const left = items.filter((item) => !item.done && !item.optional).length;

  return (
    <section className={styles.step} aria-labelledby="step-title">
      <div className={styles.stepIntro}>
        <h1
          id="step-title"
          ref={heading}
          tabIndex={-1}
          className={styles.title}
        >
          {flow.name} is ready
        </h1>
        <p className={styles.lede}>
          {left
            ? "Finish setting up now or from the plan later, in any order. Nothing here is locked in."
            : "That’s everything. Open your budget and give every dollar a job."}
        </p>
      </div>
      {/* Not a card: an open item holds the same cards as the guided steps,
          and cards never nest. */}
      <ul className={styles.checklist}>
        {items.map((item) => {
          const open = flow.open === item.id;
          return (
            <li key={item.id} className={styles.checklistItem}>
              <button
                type="button"
                className={styles.checklistRow}
                aria-expanded={open}
                onClick={() => update({ open: open ? null : item.id })}
              >
                {item.done ? (
                  <CircleCheckIcon
                    size={16}
                    className={styles.done}
                    aria-label="Done"
                  />
                ) : (
                  <CircleIcon
                    size={16}
                    className={styles.todo}
                    aria-label="Not done"
                  />
                )}
                <span className={styles.switchText}>
                  <span className={styles.switchLabel}>{item.title}</span>
                  <span className={batch.fieldHint}>{item.hint}</span>
                </span>
                {item.optional && !item.done && <Tag>Optional</Tag>}
                <ChevronRightIcon
                  size={14}
                  className={styles.chevron}
                  data-open={open || undefined}
                  aria-hidden
                />
              </button>
              {open && (
                <div className={styles.checklistBody}>
                  {item.content}
                  {item.finish && (
                    <div className={styles.stepFooter}>{item.finish}</div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Summary flow={flow} />
      <div className={styles.stepFooter}>
        <Button variant="primary" onClick={onOpen}>
          {left ? "Open my budget" : "Open my budget and assign"}
          <ChevronRightIcon aria-hidden />
        </Button>
      </div>
    </section>
  );
}
