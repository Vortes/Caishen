"use client";

import { UsersIcon } from "lucide-react";
import { AlertDialog } from "radix-ui";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "~/components/ui/segmented-control";
import { usePortalContainer } from "~/components/ui/tooltip";
import { Property } from "../app-shell/cards";
import { money, type Category } from "../app-shell/model";
import { FieldError } from "../app-shell/move-money";
import shell from "../app-shell/shell.module.css";
import target from "../app-shell/target-editor.module.css";
import banks from "../app-shell/banks.module.css";
import { PARTNER } from "./data";
import { Field, NumberWell } from "./fields";
import { hasActivity, sharedFor, splitLabel, useProto } from "./state";
import type { Variants } from "./choices";
import styles from "./batch2.module.css";

export type ShareEditing = "share" | "split" | null;

// The category's sharing, in the card that already shows "Shared · Your
// share" in the shell. Sharing and changing the split happen in place, like
// the target editor; nothing opens a dialog.
export function SharedCard({
  category,
  editing,
  onEdit,
}: {
  category: Category;
  editing: ShareEditing;
  onEdit: (editing: ShareEditing) => void;
}) {
  const { scenario, variants, actions } = useProto();
  const shared = sharedFor(scenario, category.id);
  const opener = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  // Focus returns to the button that opened the editor.
  useEffect(() => {
    if (editing) wasEditing.current = true;
    else if (wasEditing.current) {
      wasEditing.current = false;
      opener.current?.focus({ preventScroll: true });
    }
  }, [editing]);

  // Payment categories can't be shared (the engine refuses them).
  if (category.pays) return null;
  const byCard = variants.entry === "card";

  if (editing)
    return (
      <Card>
        <ShareEditor
          category={category}
          mode={shared ? "split" : "share"}
          onClose={() => onEdit(null)}
        />
      </Card>
    );

  if (!shared) {
    // With the menu as the entry point, an unshared category shows nothing
    // extra, as it does in the shell today.
    if (!byCard) return null;
    if (!scenario.partner)
      return (
        <Card>
          <Property label="Shared" icon={UsersIcon}>
            <span className={shell.faint}>Only you</span>
          </Property>
          <p className={styles.cardNote}>
            Invite a partner to split categories like rent. The rest of your
            budget stays private.
          </p>
          <div className={shell.tabActions}>
            <Button variant="quiet" onClick={actions.inviteHint}>
              Invite partner
            </Button>
          </div>
        </Card>
      );
    return (
      <Card>
        <Property label="Shared" icon={UsersIcon}>
          <span className={shell.faint}>Only you</span>
        </Property>
        <div className={shell.tabActions}>
          <Button ref={opener} variant="quiet" onClick={() => onEdit("share")}>
            Share with {PARTNER}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <Property label="Shared" icon={UsersIcon}>
        {splitLabel(shared.yourPercent)} with {PARTNER}
        <span className={shell.faint}>you pay {shared.yourPercent}%</span>
      </Property>
      {category.reserved > 0 && (
        <>
          <Property label="Reserved">{money(category.reserved)}</Property>
          <Property label="Spendable">{money(category.spendable)}</Property>
        </>
      )}
      {byCard && (
        <div className={shell.tabActions}>
          <Button ref={opener} variant="quiet" onClick={() => onEdit("split")}>
            Edit split
          </Button>
        </div>
      )}
    </Card>
  );
}

const presets = [50, 60, 40] as const;

// Shares a category, or changes the split of one that's shared, in place.
function ShareEditor({
  category,
  mode,
  onClose,
}: {
  category: Category;
  mode: "share" | "split";
  onClose: () => void;
}) {
  const { scenario, variants, actions } = useProto();
  const shared = sharedFor(scenario, category.id);
  const id = useId();
  const initial = shared?.yourPercent ?? 50;
  const [percentText, setPercentText] = useState(String(initial));
  const [custom, setCustom] = useState(
    !presets.includes(initial as (typeof presets)[number]),
  );
  const [error, setError] = useState<{
    field: "percent" | "form";
    message: string;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const percentRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const usePresets = variants.split === "presets";
  const percent = Number(percentText);
  const valid =
    /^\d{1,2}$/.test(percentText.trim()) && percent >= 1 && percent <= 99;

  useEffect(() => {
    requestAnimationFrame(() =>
      formRef.current?.scrollIntoView({ block: "nearest" }),
    );
    if (!usePresets || custom)
      percentRef.current?.focus({ preventScroll: true });
    else
      formRef.current
        ?.querySelector<HTMLElement>("[role='radio'][data-state='checked']")
        ?.focus({ preventScroll: true });
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removable = shared ? !hasActivity(scenario, shared) : false;

  const submit = () => {
    if (!valid) {
      setError({
        field: "percent",
        message: "Enter your share as a whole percent from 1 to 99.",
      });
      percentRef.current?.focus();
      return;
    }
    const blocked =
      mode === "share"
        ? actions.share(category.id, percent)
        : actions.setSplit(category.id, percent);
    if (blocked) setError({ field: "form", message: blocked });
    else onClose();
  };
  const stop = () => {
    const blocked = actions.stopSharing(category.id);
    if (blocked) {
      setConfirming(false);
      setError({ field: "form", message: blocked });
    } else onClose();
  };

  const percentField = (
    <Field
      id={`${id}-percent`}
      label="Your share"
      error={error?.field === "percent" ? error.message : undefined}
    >
      <div className={styles.percentRow}>
        <div className={styles.percentWell}>
          <NumberWell
            id={`${id}-percent`}
            inputRef={percentRef}
            value={percentText}
            suffix="%"
            error={error?.field === "percent" ? error.message : undefined}
            onChange={(value) => {
              setPercentText(value);
              setError(null);
            }}
          />
        </div>
        <span className={styles.percentOther} aria-live="polite">
          {valid
            ? `${PARTNER} pays ${100 - percent}%`
            : `${PARTNER} pays the rest`}
        </span>
      </div>
    </Field>
  );

  return (
    <form
      ref={formRef}
      className={target.form}
      noValidate
      aria-label={
        mode === "share"
          ? `Share ${category.name} with ${PARTNER}`
          : `Edit the ${category.name} split`
      }
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          if (confirming) setConfirming(false);
          else onClose();
        }
      }}
    >
      <div className={styles.editorHead}>
        <strong>
          {mode === "share"
            ? `Share ${category.name} with ${PARTNER}`
            : `${category.name} split`}
        </strong>
        <span>
          {mode === "share"
            ? `${PARTNER} gets ${category.name} in their budget under Shared. Purchases either of you make in it are split; the rest of your budget stays private.`
            : `New purchases use the new split. Purchases already recorded keep theirs. ${PARTNER} sees the change; no approval needed.`}
        </span>
      </div>

      {usePresets ? (
        <>
          <div className={target.field}>
            <span className={target.label} id={`${id}-split-label`}>
              Split · you / {PARTNER}
            </span>
            <SegmentedControl
              fill
              aria-labelledby={`${id}-split-label`}
              value={custom ? "custom" : String(percent)}
              onValueChange={(next) => {
                setError(null);
                if (next === "custom") {
                  setCustom(true);
                  requestAnimationFrame(() => percentRef.current?.focus());
                } else {
                  setCustom(false);
                  setPercentText(next);
                }
              }}
            >
              {presets.map((value) => (
                <SegmentedControlItem key={value} value={String(value)}>
                  {splitLabel(value)}
                </SegmentedControlItem>
              ))}
              <SegmentedControlItem value="custom">Custom</SegmentedControlItem>
            </SegmentedControl>
          </div>
          {custom && percentField}
        </>
      ) : (
        percentField
      )}

      <Example percent={valid ? percent : null} />

      {error?.field === "form" && (
        <FieldError id={`${id}-form-error`} message={error.message} />
      )}

      {mode === "split" && !removable && (
        <p className={target.hint}>
          {category.name} has shared purchases or settlements, so it stays
          shared to keep the history you and {PARTNER} settled against.
        </p>
      )}

      {confirming && variants.stop === "inline" ? (
        <div className={styles.confirm} role="group" aria-label="Stop sharing">
          <p>
            <strong>Stop sharing {category.name}?</strong> You and {PARTNER}{" "}
            each keep the category and its money. New purchases in it are no
            longer split.
          </p>
          <div className={styles.confirmActions}>
            <Button size="sm" onClick={() => setConfirming(false)}>
              Keep sharing
            </Button>
            <Button size="sm" variant="danger" autoFocus onClick={stop}>
              Stop sharing
            </Button>
          </div>
        </div>
      ) : (
        <div className={target.footer}>
          {mode === "split" &&
            removable &&
            (variants.stop === "dialog" ? (
              <StopDialog name={category.name} onConfirm={stop} />
            ) : (
              <Button
                size="sm"
                onClick={() =>
                  variants.stop === "undo" ? stop() : setConfirming(true)
                }
              >
                Stop sharing
              </Button>
            ))}
          <span className={target.spacer} />
          <Button size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit">
            {mode === "share" ? "Share category" : "Save split"}
          </Button>
        </div>
      )}
    </form>
  );
}

// What the split means in dollars, on a round purchase.
function Example({ percent }: { percent: number | null }) {
  if (percent === null) return null;
  const amount = 10000;
  const yours = Math.round((amount * percent) / 100);
  return (
    <p className={styles.example}>
      On a {money(amount)} purchase you cover <strong>{money(yours)}</strong>{" "}
      and {PARTNER} <strong>{money(amount - yours)}</strong>, whoever pays.
    </p>
  );
}

// The design system's confirm dialog: Radix AlertDialog on the popover
// surface, Cancel secondary and the confirm danger.
function StopDialog({
  name,
  onConfirm,
}: {
  name: string;
  onConfirm: () => void;
}) {
  const container = usePortalContainer();
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <Button size="sm">Stop sharing</Button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal container={container}>
        <AlertDialog.Overlay className={banks.overlay} />
        <AlertDialog.Content className={banks.dialog}>
          <div className={banks.header}>
            <AlertDialog.Title className={banks.title}>
              Stop sharing {name}?
            </AlertDialog.Title>
            <AlertDialog.Description className={banks.description}>
              You and {PARTNER} each keep the category and its money. New
              purchases in it are no longer split.
            </AlertDialog.Description>
          </div>
          <div className={banks.footer}>
            <AlertDialog.Cancel asChild>
              <Button>Keep sharing</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant="danger" onClick={onConfirm}>
                Stop sharing
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

// The ⋯ menu's sharing items, for the "Title ⋯ menu" entry point.
export function shareMenuItems(
  category: Category,
  variants: Variants,
  partner: boolean,
  shared: boolean,
): { label: string; editing: ShareEditing | "invite" }[] {
  if (variants.entry !== "menu" || category.pays) return [];
  if (!partner)
    return [{ label: "Invite a partner to share", editing: "invite" }];
  return shared
    ? [{ label: "Edit split", editing: "split" }]
    : [{ label: `Share with ${PARTNER}`, editing: "share" }];
}
