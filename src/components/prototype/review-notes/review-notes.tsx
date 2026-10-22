"use client";

import { CheckIcon, CopyIcon, XIcon } from "lucide-react";
import { AlertDialog, Dialog } from "radix-ui";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Button } from "~/components/ui/button";
import { IconButton } from "~/components/ui/icon-button";
import { Switch } from "~/components/ui/switch";
import { reviewMarkdown, type ItemReview } from "./markdown";
import styles from "./review-notes.module.css";

// Review notes for a prototype index: a "Looks good" switch and notes on each
// item, overall thoughts, and a Markdown export to paste back to an agent.
// Notes live in this browser's localStorage under the batch's key; without
// storage the page still works and the notes last until reload.

type Saved = { overall: string; items: Record<string, ItemReview> };

const empty: Saved = { overall: "", items: {} };

type Registered = { title: string; element: HTMLElement };

type ReviewNotes = {
  saved: Saved;
  setOverall: (overall: string) => void;
  setItem: (id: string, review: ItemReview) => void;
  clear: () => void;
  register: (id: string, item: Registered) => () => void;
  // Registered items in page order, read when the bar renders or exports.
  items: () => { id: string; title: string }[];
  version: number;
  title: string;
};

const Context = createContext<ReviewNotes | null>(null);

function useReviewNotes() {
  const notes = use(Context);
  if (!notes) throw new Error("Review notes need a ReviewNotesProvider.");
  return notes;
}

const storageName = (key: string) => `caishen:review-notes:${key}`;

function load(key: string): Saved {
  try {
    const raw = localStorage.getItem(storageName(key));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<Saved>;
    return { overall: parsed.overall ?? "", items: parsed.items ?? {} };
  } catch {
    return empty;
  }
}

function store(key: string, saved: Saved) {
  try {
    if (saved.overall || Object.keys(saved.items).length) {
      localStorage.setItem(storageName(key), JSON.stringify(saved));
    } else {
      localStorage.removeItem(storageName(key));
    }
  } catch {
    // Private mode or blocked storage: the notes last until reload.
  }
}

export function ReviewNotesProvider({
  storageKey,
  title,
  children,
}: {
  // One key per batch, like "batch-1".
  storageKey: string;
  // The batch's name, used as the export's heading.
  title: string;
  children: ReactNode;
}) {
  const [saved, setSaved] = useState<Saved>(empty);
  const loaded = useRef(false);
  const registry = useRef(new Map<string, Registered>());
  const [version, setVersion] = useState(0);

  // Storage is read after mount so the server render and hydration match.
  useEffect(() => {
    setSaved(load(storageKey));
    loaded.current = true;
  }, [storageKey]);

  useEffect(() => {
    if (loaded.current) store(storageKey, saved);
  }, [storageKey, saved]);

  const register = useCallback((id: string, item: Registered) => {
    registry.current.set(id, item);
    setVersion((v) => v + 1);
    return () => {
      if (registry.current.get(id) === item) registry.current.delete(id);
      setVersion((v) => v + 1);
    };
  }, []);

  const items = useCallback(
    () =>
      [...registry.current.entries()]
        .sort(([, a], [, b]) =>
          a.element.compareDocumentPosition(b.element) &
          Node.DOCUMENT_POSITION_FOLLOWING
            ? -1
            : 1,
        )
        .map(([id, { title }]) => ({ id, title })),
    [],
  );

  const value = useMemo<ReviewNotes>(
    () => ({
      saved,
      setOverall: (overall) => setSaved((s) => ({ ...s, overall })),
      setItem: (id, review) =>
        setSaved((s) => {
          const items = { ...s.items };
          if (review.looksGood || review.notes) items[id] = review;
          else delete items[id];
          return { ...s, items };
        }),
      clear: () => setSaved(empty),
      register,
      items,
      version,
      title,
    }),
    [saved, register, items, version, title],
  );

  return <Context value={value}>{children}</Context>;
}

// A textarea that grows with its text instead of scrolling.
function GrowingTextarea(props: ComponentProps<"textarea">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [props.value]);
  return <textarea ref={ref} rows={1} className={styles.textarea} {...props} />;
}

// The review controls for one index item: put one inside each item or state
// the owner should judge. `id` must be stable across releases so saved notes
// stay attached; `title` is what the export calls it.
export function ItemNotes({ id, title }: { id: string; title: string }) {
  const { saved, setItem, register } = useReviewNotes();
  const ref = useRef<HTMLDivElement>(null);
  const review = saved.items[id] ?? { looksGood: false, notes: "" };

  useEffect(() => {
    if (ref.current) return register(id, { title, element: ref.current });
  }, [id, title, register]);

  return (
    <div
      ref={ref}
      role="group"
      aria-label={`Review of ${title}`}
      className={styles.item}
      data-looks-good={review.looksGood || undefined}
    >
      <label className={styles.looksGood}>
        <Switch
          checked={review.looksGood}
          onCheckedChange={(looksGood) => setItem(id, { ...review, looksGood })}
        />
        <span>Looks good</span>
      </label>
      <GrowingTextarea
        aria-label="Notes"
        placeholder="Notes"
        value={review.notes}
        onChange={(event) =>
          setItem(id, { ...review, notes: event.target.value })
        }
      />
    </div>
  );
}

// Sticky at the top of the index: progress, overall thoughts, and export.
export function ReviewNotesBar() {
  const notes = useReviewNotes();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  const overallId = useId();

  // Re-read after registrations change so the total follows the page.
  void notes.version;
  const items = notes.items();
  const looksGood = items.filter((i) => notes.saved.items[i.id]?.looksGood);
  const withNotes = items.filter((i) => notes.saved.items[i.id]?.notes.trim());

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    const markdown = reviewMarkdown(
      notes.title,
      notes.saved.overall,
      items.map((item) => ({
        title: item.title,
        review: notes.saved.items[item.id],
      })),
    );
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
    } catch {
      setFallback(markdown);
    }
  };

  return (
    <div ref={setRoot} className={styles.bar}>
      <div className={styles.barRow}>
        {/* A div, not a p: index pages style their own paragraphs. */}
        <div className={styles.count} aria-live="polite">
          <span>
            {looksGood.length} of {items.length} look good
          </span>
          {withNotes.length > 0 && (
            <span className={styles.countNotes}>
              {withNotes.length} with notes
            </span>
          )}
        </div>
        <div className={styles.actions}>
          <Button variant="primary" size="sm" onClick={copy}>
            {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
            {copied ? "Copied" : "Copy as Markdown"}
          </Button>
          <ClearButton container={root} onClear={notes.clear} />
        </div>
      </div>
      <label className={styles.overallLabel} htmlFor={overallId}>
        Overall thoughts
      </label>
      <GrowingTextarea
        id={overallId}
        placeholder="What works, what doesn’t, what to try next"
        value={notes.saved.overall}
        onChange={(event) => notes.setOverall(event.target.value)}
      />
      <Dialog.Root
        open={fallback !== null}
        onOpenChange={(open) => !open && setFallback(null)}
      >
        <Dialog.Portal container={root}>
          <Dialog.Overlay className={styles.overlay} />
          <Dialog.Content
            className={styles.dialog}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              const area = (event.currentTarget as HTMLElement).querySelector(
                "textarea",
              );
              area?.focus();
              area?.select();
            }}
          >
            <div className={styles.dialogHead}>
              <Dialog.Title className={styles.dialogTitle}>
                Copy your notes
              </Dialog.Title>
              <Dialog.Close asChild>
                <IconButton label="Close">
                  <XIcon aria-hidden />
                </IconButton>
              </Dialog.Close>
            </div>
            <Dialog.Description className={styles.dialogText}>
              This browser blocked the clipboard. The Markdown is selected
              below; copy it with ⌘C or Ctrl+C.
            </Dialog.Description>
            <textarea
              aria-label="Markdown"
              className={styles.fallback}
              readOnly
              value={fallback ?? ""}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function ClearButton({
  container,
  onClear,
}: {
  container: HTMLElement | null;
  onClear: () => void;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <Button size="sm">Clear</Button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal container={container}>
        <AlertDialog.Overlay className={styles.overlay} />
        <AlertDialog.Content className={styles.dialog} data-size="confirm">
          <AlertDialog.Title className={styles.dialogTitle}>
            Clear all notes?
          </AlertDialog.Title>
          <AlertDialog.Description className={styles.dialogText}>
            Every “Looks good”, note, and overall thought on this page is
            removed from this browser. Copy them first if you need them.
          </AlertDialog.Description>
          <div className={styles.dialogActions}>
            <AlertDialog.Cancel asChild>
              <Button size="sm">Cancel</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant="danger" size="sm" onClick={onClear}>
                Clear notes
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
