"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowLeftIcon, CheckIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Field } from "~/components/ui/field";
import { Select } from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { timezoneOptions } from "~/components/settings/timezone-options";
import { EntryPage } from "./entry-page";
import { Brand } from "./brand";
import {
  CategoryQuestions,
  CategoryReview,
  categoriesFor,
  initialCategories,
  type Group,
  type CategoryDraft,
} from "./onboarding-categories";
import batch from "./entry.module.css";
import styles from "./onboarding.module.css";

export type BudgetBasics = {
  yourName: string;
  name: string;
  timezone: string;
  emailEnabled: boolean;
};
export type SetupStage = "basics" | "categories" | "accounts" | "ready";
const steps = ["Your budget", "Categories", "Accounts", "Ready"];
const stages: SetupStage[] = ["basics", "categories", "accounts", "ready"];

export function GuidedOnboarding({
  onCreate,
  onCategories,
  invitedBy,
  accounts,
  readyToAssign,
  onComplete,
  initialStage = "basics",
  onStageChange,
  partner,
  email,
  initialName = "",
  onSignOut,
  initialDraft = initialCategories,
  onDraftChange,
}: {
  onCreate: (input: BudgetBasics) => Promise<void>;
  onCategories: (groups: Group[]) => Promise<void>;
  // Who sent the invitation this setup accepts.
  invitedBy?: string;
  accounts: ReactNode;
  readyToAssign: number;
  onComplete: () => void;
  initialStage?: SetupStage;
  onStageChange?: (stage: SetupStage) => void;
  partner?: ReactNode;
  email?: string;
  initialName?: string;
  onSignOut?: () => void;
  initialDraft?: CategoryDraft;
  onDraftChange?: (draft: CategoryDraft) => void;
}) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [stage, setStage] = useState(initialStage);
  const [yourName, setYourName] = useState(initialName);
  const [name, setName] = useState("My budget");
  const [timezone, setTimezone] = useState("America/Los_Angeles");
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [draft, setDraft] = useState(initialDraft);
  // Categories open on the questions; their answers then fill the list.
  const [reviewing, setReviewing] = useState(false);
  const [answered, setAnswered] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () => setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone),
    [],
  );
  const review = (on: boolean) => {
    setReviewing(on);
    requestAnimationFrame(() => heading.current?.focus());
  };
  const go = (next: SetupStage) => {
    setStage(next);
    setReviewing(false);
    setError(null);
    onStageChange?.(next);
    requestAnimationFrame(() => heading.current?.focus());
  };
  const submit = async (action: () => Promise<void>, next: SetupStage) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      go(next);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Couldn’t save. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const groups = categoriesFor(draft.answers).map((group) => ({
    ...group,
    categories: group.categories.filter(
      (category) => !draft.unchecked.includes(category),
    ),
  }));
  if (draft.custom.length)
    groups.push({
      name: "Your own",
      categories: draft.custom.filter(
        (category) => !draft.unchecked.includes(category),
      ),
    });
  const step = stages.indexOf(stage);
  return (
    <EntryPage>
      <div className={styles.frame}>
        <header className={styles.header}>
          <Brand />
          <span className={styles.account}>
            {email}
            {onSignOut && (
              <Button size="sm" variant="quiet" onClick={onSignOut}>
                Sign out
              </Button>
            )}
          </span>
        </header>
        <main className={styles.main}>
          <ol className={styles.stepper} aria-label="Budget setup">
            {steps.map((label, index) => (
              <li
                key={label}
                data-state={
                  index === step ? "current" : index < step ? "done" : undefined
                }
                aria-current={index === step ? "step" : undefined}
              >
                {index < step ? (
                  <CheckIcon size={14} aria-hidden />
                ) : (
                  <span className={styles.stepNumber}>{index + 1}</span>
                )}
                <span className={styles.stepLabel}>{label}</span>
              </li>
            ))}
          </ol>
          <section className={styles.step} aria-labelledby="setup-title">
            <h1
              ref={heading}
              id="setup-title"
              tabIndex={-1}
              className={styles.title}
            >
              {stage === "basics"
                ? invitedBy
                  ? `${invitedBy} invited you. Let’s set up your budget.`
                  : "Welcome. Let’s set up your budget."
                : stage === "categories"
                  ? reviewing
                    ? "Keep what fits"
                    : "A few questions about you"
                  : stage === "accounts"
                    ? "Add the accounts you spend from"
                    : "Your budget is ready"}
            </h1>
            {stage === "basics" && (
              <form
                className={styles.form}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!yourName.trim()) {
                    setError("Tell us your name.");
                    return;
                  }
                  if (!name.trim()) {
                    setError("Give your budget a name.");
                    return;
                  }
                  void submit(
                    () =>
                      onCreate({
                        yourName: yourName.trim(),
                        name: name.trim(),
                        timezone,
                        emailEnabled,
                      }),
                    "categories",
                  );
                }}
              >
                <Card>
                  <div className={styles.fields}>
                    <div className={batch.field}>
                      <label className={batch.fieldLabel} htmlFor={`${id}-you`}>
                        Your name
                      </label>
                      <input
                        id={`${id}-you`}
                        className={batch.input}
                        value={yourName}
                        maxLength={80}
                        aria-required
                        autoComplete="name"
                        onChange={(event) => setYourName(event.target.value)}
                      />
                    </div>
                    <div className={batch.field}>
                      <label
                        className={batch.fieldLabel}
                        htmlFor={`${id}-name`}
                      >
                        Budget name
                      </label>
                      <input
                        id={`${id}-name`}
                        className={batch.input}
                        value={name}
                        maxLength={80}
                        autoComplete="off"
                        onChange={(event) => setName(event.target.value)}
                      />
                    </div>
                    <Field label="Timezone">
                      <Select
                        value={timezone}
                        onChange={setTimezone}
                        options={timezoneOptions(timezone)}
                      />
                    </Field>
                    <label className={styles.switchRow}>
                      <span className={styles.switchLabel}>
                        Daily review email
                      </span>
                      <Switch
                        checked={emailEnabled}
                        onCheckedChange={setEmailEnabled}
                      />
                    </label>
                  </div>
                </Card>
                {error && (
                  <p className={batch.error} role="alert">
                    {error}
                  </p>
                )}
                <div className={batch.actions} data-end>
                  <Button variant="primary" type="submit" disabled={busy}>
                    {busy ? "Creating your budget…" : "Create my budget"}
                    <ChevronRightIcon aria-hidden />
                  </Button>
                </div>
              </form>
            )}
            {stage === "categories" && !reviewing && (
              <CategoryQuestions
                flow={draft}
                update={(change) => {
                  const next = { ...draft, ...change };
                  setDraft(next);
                  onDraftChange?.(next);
                }}
                answered={answered}
                onAnswered={setAnswered}
                onDone={() => review(true)}
                onSkip={() => go("accounts")}
              />
            )}
            {stage === "categories" && reviewing && (
              <div className={styles.reveal}>
                <CategoryReview
                  flow={draft}
                  update={(change) => {
                    const next = { ...draft, ...change };
                    setDraft(next);
                    onDraftChange?.(next);
                  }}
                />
                {error && (
                  <p className={batch.error} role="alert">
                    {error}
                  </p>
                )}
                <div className={batch.actions} data-end>
                  <div className={styles.back}>
                    <Button
                      variant="quiet"
                      disabled={busy}
                      onClick={() => review(false)}
                    >
                      <ArrowLeftIcon aria-hidden />
                      Back
                    </Button>
                  </div>
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() =>
                      void submit(() => onCategories(groups), "accounts")
                    }
                  >
                    {busy ? "Saving categories…" : "Continue"}
                  </Button>
                </div>
              </div>
            )}
            {stage === "accounts" && (
              <>
                {accounts}
                <div className={batch.actions} data-end>
                  <div className={styles.back}>
                    <Button
                      variant="quiet"
                      disabled={busy}
                      onClick={() => {
                        go("categories");
                        setReviewing(true);
                      }}
                    >
                      <ArrowLeftIcon aria-hidden />
                      Back
                    </Button>
                  </div>
                  <Button variant="quiet" onClick={() => go("ready")}>
                    Skip for now
                  </Button>
                  <Button variant="primary" onClick={() => go("ready")}>
                    Continue
                  </Button>
                </div>
              </>
            )}
            {stage === "ready" && (
              <>
                <Card>
                  <div className={styles.figure}>
                    <span className={batch.fieldLabel}>Ready to Assign</span>
                    <strong data-empty={readyToAssign === 0 || undefined}>
                      {new Intl.NumberFormat("en-US", {
                        style: "currency",
                        currency: "USD",
                      }).format(readyToAssign / 100)}
                    </strong>
                  </div>
                </Card>
                {partner}
                <div className={batch.actions} data-end>
                  <div className={styles.back}>
                    <Button
                      variant="quiet"
                      disabled={busy}
                      onClick={() => go("accounts")}
                    >
                      <ArrowLeftIcon aria-hidden />
                      Back
                    </Button>
                  </div>
                  <Button variant="primary" onClick={onComplete}>
                    Open my budget
                    <ChevronRightIcon aria-hidden />
                  </Button>
                </div>
              </>
            )}
          </section>
        </main>
      </div>
    </EntryPage>
  );
}
