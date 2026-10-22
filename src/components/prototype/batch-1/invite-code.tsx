"use client";

import { CheckIcon, CircleAlertIcon, CopyIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import batch from "./batch.module.css";
import styles from "./invite-code.module.css";

// Invite codes are 8 characters shown as two groups of four, like
// KQ7M-4XPD. The alphabet drops 0, 1, I, L, and O, so a code read aloud or
// copied by hand can't be mistaken for another.
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const LENGTH = 8;

// What the server says about a code, before or while joining.
export type CodeResult =
  "valid" | "invalid" | "expired" | "used" | "full" | "own" | "rate-limited";

// One code inside pasted text, with or without its dash or a space.
const codeInText = new RegExp(
  `(?:^|[^${CODE_ALPHABET}])([${CODE_ALPHABET}]{4})[ -]?([${CODE_ALPHABET}]{4})(?![${CODE_ALPHABET}])`,
);

// Takes anything typed or pasted (lowercase, spaces, a missing dash, or a
// whole message with the code in it) and keeps the code, as XXXX-XXXX.
export function formatCode(raw: string) {
  const upper = raw.toUpperCase();
  const found = codeInText.exec(upper);
  if (found) return `${found[1]}-${found[2]}`;
  const characters = upper
    .split("")
    .filter((character) => CODE_ALPHABET.includes(character))
    .slice(0, LENGTH)
    .join("");
  return characters.length > 4
    ? `${characters.slice(0, 4)}-${characters.slice(4)}`
    : characters;
}

export const isComplete = (code: string) =>
  code.replace("-", "").length === LENGTH;

// Characters people type that a code never contains.
const lookalikes = /[01ILO]/i;

export function codeError(result: CodeResult, code: string): string | null {
  switch (result) {
    case "valid":
      return null;
    case "invalid":
      return `No invite matches ${code}. Check each character with your partner.`;
    case "expired":
      return "This code expired. Codes last 24 hours; ask your partner for a new one.";
    case "used":
      return "This code was already used. Each code works once; ask your partner for a new one.";
    case "full":
      return "That budget already has a partner connected, and a budget has room for one.";
    case "own":
      return "That’s the code you created. Give it to your partner to enter in their own account.";
    case "rate-limited":
      return "Too many tries. For your security, codes can be checked again in 10 minutes.";
  }
}

// The field for entering a partner's code. Formats as you type or paste,
// says which characters don't exist, and locks while too many tries cool
// down.
export function CodeField({
  id,
  label,
  value,
  onChange,
  error,
  locked,
  action,
}: {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (code: string) => void;
  error: string | null;
  // Seconds left before checking is allowed again.
  locked?: number;
  action: ReactNode;
}) {
  const [lookalike, setLookalike] = useState(false);
  const message = error;
  const hint = lookalike
    ? "Codes never use 0, 1, I, L, or O. Check those characters again."
    : null;
  return (
    <div className={styles.field}>
      <label className={batch.fieldLabel} htmlFor={id}>
        {label}
      </label>
      <div className={styles.row}>
        <input
          id={id}
          className={`${batch.input} ${styles.input}`}
          value={value}
          placeholder="XXXX-XXXX"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          // Room for a pasted sentence; formatting keeps the code.
          maxLength={64}
          disabled={Boolean(locked)}
          aria-invalid={Boolean(message)}
          aria-describedby={`${id}-format ${message ? `${id}-error` : ""}`}
          onChange={(event) => {
            setLookalike(lookalikes.test(event.target.value));
            onChange(formatCode(event.target.value));
          }}
        />
        {action}
      </div>
      <span id={`${id}-format`} className={batch.fieldHint}>
        {hint ?? "8 letters and numbers, from your partner’s Settings."}
      </span>
      {message && (
        <span id={`${id}-error`} className={batch.error} role="alert">
          <CircleAlertIcon size={13} aria-hidden />
          {message}
        </span>
      )}
      {/* The countdown stays out of the alert, so screen readers hear the
          message once instead of every second. */}
      {Boolean(locked) && (
        <span className={batch.fieldHint} aria-hidden>
          Unlocks in {clock(locked!)}
        </span>
      )}
    </div>
  );
}

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

// Counts down a rate limit, one second at a time.
export function useLock(active: boolean, seconds = 600) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!active) return setLeft(0);
    setLeft(seconds);
    const timer = window.setInterval(
      () => setLeft((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [active, seconds]);
  return left;
}

// A code the user created, big enough to read to someone, with Copy.
export function CodeDisplay({
  code,
  expires,
  onNew,
}: {
  code: string;
  expires: string;
  onNew?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <div className={styles.display}>
      <div className={styles.displayText}>
        <code className={styles.code} aria-label={code.split("").join(" ")}>
          {code}
        </code>
        <span className={batch.fieldHint}>Works once. Expires {expires}.</span>
      </div>
      <div className={batch.actions}>
        {onNew && (
          <Button size="sm" variant="quiet" onClick={onNew}>
            New code
          </Button>
        )}
        <Button
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(code).catch(() => undefined);
            setCopied(true);
          }}
        >
          {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
