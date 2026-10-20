"use client";

import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";

import { type Command } from "~/domain/engine";
import { FormField, Icon, SelectField } from "~/components/shared";
import { type Panel, type State } from "~/components/budget/types";
import { newId, text } from "~/components/budget/format";
import { BankConnections } from "~/components/banks/bank-connections";
import { TimezoneOptions } from "~/components/settings/timezone-options";

export function SettingsView({
  state,
  run,
  busy,
  open,
  sync,
  syncBusy,
}: {
  state: State;
  run: (command: Command) => void;
  busy: boolean;
  open: (panel: Panel) => void;
  sync: () => void;
  syncBusy: boolean;
}) {
  const view = state.view!;
  return (
    <div className="main-grid">
      <div className="stack">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Personal preferences</h2>
              <p>Your budget and daily review</p>
            </div>
          </div>
          <form
            key={JSON.stringify([view.budget.name, view.budget.settings])}
            className="panel-body"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              run({
                type: "settings.update",
                id: newId(),
                name: text(data, "name"),
                timezone: text(data, "timezone"),
                emailEnabled: data.has("emailEnabled"),
                emailHour: Number(text(data, "emailHour")),
              });
            }}
          >
            <div className="form-grid">
              <FormField
                label="Budget name"
                name="name"
                defaultValue={view.budget.name}
                maxLength={120}
                required
              />
              <div className="form-row">
                <SelectField
                  label="Timezone"
                  name="timezone"
                  defaultValue={view.budget.settings.timezone}
                >
                  <TimezoneOptions />
                </SelectField>
                <SelectField
                  label="Daily email time"
                  name="emailHour"
                  defaultValue={view.budget.settings.emailHour}
                >
                  {Array.from({ length: 24 }, (_, hour) => (
                    <option key={hour} value={hour}>
                      {new Date(2026, 0, 1, hour).toLocaleTimeString("en-US", {
                        hour: "numeric",
                      })}
                    </option>
                  ))}
                </SelectField>
              </div>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  name="emailEnabled"
                  defaultChecked={view.budget.settings.emailEnabled}
                />
                <span>
                  Send my daily review email
                  <p className="field-hint">
                    Email links to your private inbox. Delivery requires the
                    email service and hosted scheduler to be configured.
                  </p>
                </span>
              </label>
            </div>
            <div className="form-actions">
              <Button disabled={busy} type="submit">
                {busy ? "Saving…" : "Save preferences"}
              </Button>
            </div>
          </form>
        </section>
        <BankConnections state={state} />
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Services & account updates</h2>
              <p>Live availability, without the guesswork</p>
            </div>
            <Button
              variant="secondary"
              onClick={sync}
              disabled={syncBusy || !state.connections.length}
            >
              {syncBusy ? "Updating…" : "Update accounts"}
            </Button>
          </div>
          <div className="panel-body">
            {state.services.map((service) => (
              <div className="service-row" key={service.name}>
                <div>
                  <strong>{service.name}</strong>
                  <p>{service.detail}</p>
                </div>
                <span
                  className={cn(
                    "badge",
                    service.status !== "configured" && "warning",
                  )}
                >
                  {service.status === "configured"
                    ? "Configured"
                    : "Setup needed"}
                </span>
              </div>
            ))}
          </div>
          <div className="panel-footer">
            Daily account updates depend on your institution. A recent cached
            balance alone does not prove reconciliation.
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Standing rules</h2>
              <p>Only rules you explicitly establish can cover overspending.</p>
            </div>
          </div>
          <div className="panel-body">
            {view.budget.rules.length ? (
              view.budget.rules.map((rule) => (
                <p key={rule.id} className="small">
                  Cover{" "}
                  {
                    view.categories.find(
                      (category) => category.id === rule.toCategoryId,
                    )?.name
                  }{" "}
                  from{" "}
                  {
                    view.categories.find(
                      (category) => category.id === rule.fromCategoryId,
                    )?.name
                  }{" "}
                  · {rule.enabled ? "Enabled" : "Disabled"}
                  <Button
                    variant="ghost"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run({
                        type: "rule.set",
                        id: newId(),
                        ruleId: rule.id,
                        fromCategoryId: rule.fromCategoryId,
                        toCategoryId: rule.toCategoryId,
                        enabled: !rule.enabled,
                      })
                    }
                  >
                    {rule.enabled ? "Disable" : "Enable"}
                  </Button>
                </p>
              ))
            ) : (
              <p className="small muted">
                No standing rules. Cover overspending by choosing and moving
                money yourself.
              </p>
            )}
            <Button
              variant="ghost"
              style={{ marginTop: 10 }}
              disabled={view.categories.length < 2}
              onClick={() => open({ type: "rule" })}
            >
              Create a standing rule
            </Button>
          </div>
        </section>
      </div>
      <div className="stack">
        <section className="panel info-card">
          <span className="info-card-icon">
            <Icon name="shield" size={21} />
          </span>
          <h2>Private by design</h2>
          <p>
            Your partner sees shared expenses, allocations, and repayments
            needed for settlement. Your unrelated transactions and account
            balances stay private.
          </p>
        </section>
        <section className="panel">
          <div className="panel-header">
            <h2>Recent budget activity</h2>
          </div>
          <div className="panel-body">
            {view.audit.length ? (
              <ul className="audit-list">
                {view.audit
                  .slice(-10)
                  .reverse()
                  .map((entry) => (
                    <li key={entry.id}>
                      <span className="muted">#{entry.sequence}</span>
                      <span>
                        {entry.type.replaceAll(".", " · ")}
                        <small className="muted" style={{ display: "block" }}>
                          {entry.source === "user"
                            ? "Your action"
                            : "Agent bookkeeping"}
                        </small>
                      </span>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="small muted">
                Your validated budget changes will appear here.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
