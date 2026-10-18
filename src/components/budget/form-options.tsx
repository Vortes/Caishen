type NamedItem = { id: string; name: string };

export function EntityOptions({
  items,
  emptyLabel,
}: {
  items: readonly NamedItem[];
  emptyLabel: string;
}) {
  return (
    <>
      {!items.length && <option value="">{emptyLabel}</option>}
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </>
  );
}
