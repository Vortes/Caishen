"use client";

import { ChevronDownIcon } from "lucide-react";
import {
  Fragment,
  cloneElement,
  isValidElement,
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { moveSelection } from "./move-selection";
import { RowCheckbox } from "./row-checkbox";
import { SelectAll } from "./select-all";
import { useRowSelection } from "./use-row-selection";
import selectionStyles from "./row-selection.module.css";
import styles from "./register.module.css";

type Attributes = Record<`data-${string}`, string | boolean | undefined>;

export type RegisterColumn = {
  key: string;
  // An element supplies its own header cell, including responsive alternatives.
  label: ReactNode;
  optional?: boolean;
  numeric?: boolean;
};

export type RegisterCells = {
  label: string;
  content: ReactNode;
  controls?: ReactNode;
  openColumns?: readonly string[];
  attributes?: Attributes & { title?: string; "aria-expanded"?: boolean };
};

export type RegisterSection<Row> = {
  key: string;
  label: ReactNode;
  "aria-label"?: string;
  rows: readonly Row[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export type RegisterProps<Row extends { id: string }> = Attributes & {
  columns: readonly RegisterColumn[];
  rows: readonly Row[];
  cells: (row: Row) => RegisterCells;
  // Omitted when the register never checks rows: no checkboxes, no Select
  // all, and no checked styling.
  checkable?: (row: Row) => boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  checked: readonly string[];
  onCheck: (ids: string[], value: boolean) => void;
  onOpen: (row: Row, column?: string) => void;
  editingId?: string | null;
  renderEditor?: (row: Row | undefined) => ReactNode;
  sections?: readonly RegisterSection<Row>[];
  empty?: ReactNode;
  noMatch?: ReactNode;
  actionBar?: ReactNode;
  "aria-label"?: string;
  ref?: Ref<HTMLDivElement>;
  layout?: { wide: string; narrow?: string; compact?: string; gutter?: string };
};

// Grid tracks include the empty part of right-aligned cells and the gaps
// between fields. Only the caller knows which columns it can open.
function columnAt(
  row: HTMLElement,
  x: number,
  openColumns?: readonly string[],
) {
  const style = getComputedStyle(row);
  const tracks = style.gridTemplateColumns.split(" ").map(parseFloat);
  const gap = parseFloat(style.columnGap);
  let left =
    row.getBoundingClientRect().left +
    parseFloat(style.borderLeftWidth) +
    parseFloat(style.paddingLeft);
  const children = [...row.children].filter(
    (cell): cell is HTMLElement => cell instanceof HTMLElement,
  );
  const measured = children.filter((cell) => cell.getClientRects().length > 0);
  const cells = measured.length ? measured : children;
  let nearest: { column: string; distance: number } | undefined;
  cells.forEach((cell, index) => {
    const right = left + (tracks[index] ?? 0);
    const column = cell.dataset.column;
    if (column && (!openColumns || openColumns.includes(column))) {
      const distance = x < left ? left - x : x > right ? x - right : 0;
      if (!nearest || distance < nearest.distance)
        nearest = { column, distance };
    }
    left = right + gap;
  });
  return nearest?.column;
}

export function Register<Row extends { id: string }>({
  columns,
  rows,
  cells,
  checkable,
  selectedId,
  onSelect,
  checked,
  onCheck,
  onOpen,
  editingId,
  renderEditor,
  sections = [],
  empty,
  noMatch,
  actionBar,
  "aria-label": label = "Register",
  ref,
  layout,
  ...attributes
}: RegisterProps<Row>) {
  const grouped = new Set(
    sections.flatMap((section) => section.rows.map((row) => row.id)),
  );
  const ordinary = rows.filter((row) => !grouped.has(row.id));
  const visible = [
    ...sections.flatMap((section) => (section.open ? section.rows : [])),
    ...ordinary,
  ];
  const selectable = checkable ? visible.filter(checkable) : [];
  const selected = selectable.filter((row) => checked.includes(row.id));
  const root = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => root.current!);
  const previousEditing = useRef(editingId);
  useEffect(() => {
    const id = previousEditing.current;
    previousEditing.current = editingId;
    if (id && !editingId && document.activeElement === document.body)
      root.current
        ?.querySelector<HTMLButtonElement>(
          `[data-register-row="${CSS.escape(id)}"]`,
        )
        ?.focus({ preventScroll: true });
  }, [editingId]);
  useEffect(() => {
    if (!selectedId) return;
    const row = root.current?.querySelector<HTMLButtonElement>(
      `[data-register-row="${CSS.escape(selectedId)}"]`,
    );
    row?.scrollIntoView({ block: "nearest" });
    row?.focus({ preventScroll: true });
  }, [selectedId]);
  const selection = useRowSelection(checked);
  const anchor = useRef<string | null>(null);
  const checkTo = (id: string) => {
    const order = selectable.map((row) => row.id);
    const from = order.indexOf(anchor.current ?? selectedId ?? "");
    const to = order.indexOf(id);
    onCheck(
      from < 0 ? [id] : order.slice(Math.min(from, to), Math.max(from, to) + 1),
      !checked.includes(id),
    );
    anchor.current = id;
  };
  const renderRow = (row: Row) => {
    if (editingId === row.id)
      return <Fragment key={row.id}>{renderEditor?.(row)}</Fragment>;
    const cell = cells(row);
    const canCheck = checkable?.(row) ?? false;
    const isChecked = canCheck && checked.includes(row.id);
    return (
      <div
        key={row.id}
        className={`${styles.rowWrap} ${checkable ? selectionStyles.row : ""}`}
        {...(checkable ? selection.rowProps(row.id) : {})}
        onMouseDown={(event) => {
          if ((canCheck && event.shiftKey) || event.detail > 1)
            event.preventDefault();
        }}
      >
        {canCheck && (
          <RowCheckbox
            label={`Select ${cell.label}`}
            state={isChecked}
            onShiftClick={() => checkTo(row.id)}
            onChange={() => {
              anchor.current = row.id;
              onCheck([row.id], !isChecked);
            }}
          />
        )}
        <button
          {...cell.attributes}
          type="button"
          data-row
          data-register-row={row.id}
          data-id={canCheck ? row.id : undefined}
          className={`${styles.columns} ${styles.row}`}
          aria-current={selectedId === row.id ? "true" : undefined}
          onClick={(event) => {
            if (canCheck && event.shiftKey) {
              checkTo(row.id);
              return;
            }
            if (event.detail > 0 && window.getSelection()?.toString()) return;
            anchor.current = row.id;
            if (selectedId === row.id && event.detail > 0) {
              const clicked =
                event.target instanceof Element
                  ? event.target.closest<HTMLElement>("[data-column]")?.dataset
                      .column
                  : undefined;
              onOpen(
                row,
                clicked &&
                  (!cell.openColumns || cell.openColumns.includes(clicked))
                  ? clicked
                  : columnAt(
                      event.currentTarget,
                      event.clientX,
                      cell.openColumns,
                    ),
              );
              return;
            }
            if (selectedId !== row.id) onSelect(row.id);
          }}
        >
          {cell.content}
        </button>
        {cell.controls}
      </div>
    );
  };
  const docked = Boolean(
    editingId && !rows.some((row) => row.id === editingId),
  );
  if (!rows.length && !docked) return noMatch ?? empty;
  return (
    <div
      {...attributes}
      ref={root}
      className={`${styles.list} ${styles.register} ${selectionStyles.list}`}
      style={
        {
          "--row-gutter": layout?.gutter,
          "--columns-wide":
            layout?.wide ??
            columns
              .map((column) => (column.numeric ? "6.5rem" : "minmax(0, 1fr)"))
              .join(" "),
          "--columns-narrow":
            layout?.narrow ??
            (layout
              ? undefined
              : columns
                  .filter((column) => !column.optional)
                  .map((column) =>
                    column.numeric ? "6.5rem" : "minmax(0, 1fr)",
                  )
                  .join(" ")),
          "--columns-compact": layout?.compact,
        } as CSSProperties
      }
      {...selection.listProps}
      role="group"
      aria-label={label}
      data-selecting={selected.length > 0 || undefined}
      onKeyDown={(event) => {
        if (
          event.defaultPrevented ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          !(event.target instanceof HTMLElement) ||
          event.target.closest(
            'input, textarea, select, [contenteditable="true"], form, [role="dialog"], [role="menu"]',
          )
        )
          return;
        if (event.key === "e" && !editingId) {
          const row = visible.find((row) => row.id === selectedId);
          if (row) {
            event.preventDefault();
            event.stopPropagation();
            onOpen(row);
          }
          return;
        }
        if (!event.target.matches("[data-register-row]")) return;
        const id = event.target.dataset.id;
        if (event.key === "x" && id) {
          event.preventDefault();
          anchor.current = id;
          onCheck([id], !checked.includes(id));
          return;
        }
        moveSelection(event);
      }}
    >
      <div className={`${styles.columns} ${styles.columnHeader}`}>
        <SelectAll selection={{ selectable, selected }} onCheck={onCheck} />
        {columns.map((column) => (
          <Fragment key={column.key}>
            {isValidElement<
              Attributes & { className?: string; "aria-hidden"?: boolean }
            >(column.label) && column.label.type !== Fragment ? (
              cloneElement(column.label, {
                "data-column": column.key,
                "data-optional": column.optional ? true : undefined,
                "aria-hidden": true,
                className:
                  [
                    column.label.props.className,
                    column.numeric ? styles.numeric : undefined,
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined,
              })
            ) : (
              <span
                data-column={column.key}
                data-optional={column.optional ? true : undefined}
                className={column.numeric ? styles.numeric : undefined}
                aria-hidden
              >
                {column.label}
              </span>
            )}
          </Fragment>
        ))}
      </div>
      {docked && (
        <div className={styles.editorDock}>{renderEditor?.(undefined)}</div>
      )}
      {sections
        .filter((section) => section.rows.length > 0)
        .map((section) => (
          <div
            key={section.key}
            role="group"
            aria-label={section["aria-label"]}
            className={styles.pendingGroup}
          >
            <button
              type="button"
              className={`${styles.dayRow} ${styles.groupRow} ${styles.pendingHeader}`}
              aria-expanded={section.open}
              onClick={() => section.onOpenChange(!section.open)}
            >
              <ChevronDownIcon
                size={12}
                strokeWidth={2.5}
                className={styles.groupCaret}
                aria-hidden
              />
              <span>{section.label}</span>
              <span className={styles.groupCount}>{section.rows.length}</span>
            </button>
            {section.rows
              .filter((row) => section.open || row.id === editingId)
              .map(renderRow)}
          </div>
        ))}
      {ordinary.map(renderRow)}
      {actionBar}
    </div>
  );
}
