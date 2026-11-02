import { SharePickerLab } from "./lab";

// The share picker, three ways, on a register of worst-case lines.
export default async function SharePickerPage({
  searchParams,
}: {
  searchParams: Promise<{ v?: string; data?: string; theme?: string }>;
}) {
  const { v, data, theme } = await searchParams;
  return (
    <SharePickerLab
      variant={Math.max(0, Math.min(2, (Number(v) || 1) - 1))}
      data={
        data === "worst" || data === "partner" || data === "empty"
          ? data
          : "demo"
      }
      theme={theme === "light" ? "light" : "dark"}
    />
  );
}
