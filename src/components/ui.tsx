"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

export type IconName =
  | "budget"
  | "transactions"
  | "shared"
  | "loans"
  | "settings"
  | "plus"
  | "arrow"
  | "check"
  | "chevron"
  | "close"
  | "bank"
  | "card"
  | "clock"
  | "shield";

const paths: Record<IconName, ReactNode> = {
  budget: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M3 9h18M8 13h3m-3 3h5m4-3h1" />
    </>
  ),
  transactions: (
    <>
      <path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4" />
    </>
  ),
  shared: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m3 9v-2a6 6 0 0 0-3-5" />
    </>
  ),
  loans: (
    <>
      <path d="M4 20h16M5 16l4-5 4 2 6-9M15 4h4v4" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="3" />
      <circle cx="15" cy="17" r="3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  bank: (
    <>
      <path d="m3 9 9-6 9 6M3 21h18M5 9v8m7-8v8m7-8v8" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M3 10h18m-14 5h3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  shield: (
    <>
      <path d="m12 3 8 3v6c0 4-5 8-8 9-3-1-8-5-8-9V6l8-3Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand${light ? "brand-light" : ""}`}>
      <span className="brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span>
        caishen<span className="brand-period">.</span>
      </span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: IconName;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={25} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label id={id}>{label}</label>
      <div aria-labelledby={id}>{children}</div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function FormField({
  label,
  hint,
  name,
  ...props
}: {
  label: string;
  hint?: string;
  name: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input {...props} id={id} name={name} />
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function SelectField({
  label,
  name,
  children,
  hint,
  ...props
}: {
  label: string;
  name: string;
  children: ReactNode;
  hint?: string;
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select {...props} id={id} name={name}>
        {children}
      </select>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function Dialog({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog-head">
        <div>
          <p className="eyebrow">Your budget</p>
          <h2 id={titleId}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function Amount({
  value,
  signed = false,
  className = "",
}: {
  value: number;
  signed?: boolean;
  className?: string;
}) {
  return (
    <span className={`money ${className}`}>
      {new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        signDisplay: signed ? "exceptZero" : "auto",
      }).format(value / 100)}
    </span>
  );
}
