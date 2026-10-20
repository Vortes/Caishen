"use client";

import { Button } from "~/components/ui-legacy/button";

import { api } from "~/trpc/react";
import { Brand, FormField, Icon, SelectField } from "~/components/shared";
import { text } from "~/components/budget/format";
import { TimezoneOptions } from "~/components/settings/timezone-options";

export function Onboarding({
  month,
  onComplete,
}: {
  month: string;
  onComplete: () => void;
}) {
  const onboard = api.budget.onboard.useMutation({ onSuccess: onComplete });
  return (
    <main className="onboarding">
      <Brand />
      <p className="eyebrow" style={{ marginTop: 40 }}>
        A fresh start
      </p>
      <h1>Let’s give your money a home.</h1>
      <p>
        Start with your own personal budget. Add your real account balances,
        create a few categories, then decide where your money should go.
      </p>
      <form
        className="panel"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          onboard.mutate({
            name: text(data, "name"),
            month,
            timezone: text(data, "timezone"),
          });
        }}
      >
        <div className="form-grid">
          <FormField
            label="Budget name"
            name="name"
            autoComplete="off"
            placeholder="My personal budget"
            defaultValue="My budget"
            maxLength={80}
            required
            autoFocus
          />
          <SelectField
            label="Your timezone"
            name="timezone"
            defaultValue="America/Los_Angeles"
          >
            <TimezoneOptions />
          </SelectField>
          <p className="field-hint">
            US dollars · Daily review email defaults to 8 a.m. in your timezone.
            Configure or disable it in Settings.
          </p>
        </div>
        {onboard.error && (
          <p className="form-error" role="alert">
            {onboard.error.message}
          </p>
        )}
        <div className="form-actions">
          <Button disabled={onboard.isPending} type="submit">
            {onboard.isPending ? "Creating your budget…" : "Create my budget"}
            <Icon name="arrow" size={16} />
          </Button>
        </div>
      </form>
      <p className="privacy-note">
        <Icon name="shield" size={17} />
        Your partner has their own budget. Only the shared expenses and
        repayments you need to settle together are shared.
      </p>
    </main>
  );
}
