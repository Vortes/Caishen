export const SHELL_PATH = "/app";
const SETTINGS_PATH = `${SHELL_PATH}/settings`;

export type Screen =
  | { type: "plan" }
  | { type: "reflect" }
  | { type: "register"; accountId: string | null }
  | { type: "loans"; loanId: string | null };

export type SettingsPage = "profile" | "appearance" | "partner";

const settingsPages: Record<SettingsPage, string> = {
  profile: SETTINGS_PATH,
  appearance: `${SETTINGS_PATH}/appearance`,
  partner: `${SETTINGS_PATH}/partner`,
};

// The settings page an address shows, or null for the shell itself.
export function settingsPageAt(pathname: string) {
  const entry = Object.entries(settingsPages).find(
    ([, path]) => path === pathname,
  );
  return entry ? (entry[0] as SettingsPage) : null;
}

export function screenAt(pathname: string): Screen | null {
  if (pathname === SHELL_PATH) return { type: "plan" };
  if (pathname === `${SHELL_PATH}/reflect`) return { type: "reflect" };
  if (pathname === `${SHELL_PATH}/accounts`)
    return { type: "register", accountId: null };
  if (pathname === `${SHELL_PATH}/loans`)
    return { type: "loans", loanId: null };
  const item = /^\/app\/(accounts|loans)\/([^/]+)$/.exec(pathname);
  if (!item) return null;
  try {
    const id = decodeURIComponent(item[2]!);
    return item[1] === "accounts"
      ? { type: "register", accountId: id }
      : { type: "loans", loanId: id };
  } catch {
    return null;
  }
}

export function screenHref(screen: Screen, search = new URLSearchParams()) {
  const query = new URLSearchParams();
  const month = search.get("month");
  if (month) query.set("month", month);
  const path =
    screen.type === "plan"
      ? SHELL_PATH
      : screen.type === "reflect"
        ? `${SHELL_PATH}/reflect`
        : screen.type === "register"
          ? `${SHELL_PATH}/accounts${screen.accountId ? `/${encodeURIComponent(screen.accountId)}` : ""}`
          : `${SHELL_PATH}/loans${screen.loanId ? `/${encodeURIComponent(screen.loanId)}` : ""}`;
  return `${path}${query.size ? `?${query}` : ""}`;
}

// Settings keep the underlying address in the URL, including after a reload.
export function settingsReturnHref(search: URLSearchParams) {
  const href = search.get("returnTo");
  if (href?.startsWith(`${SHELL_PATH}`) && !href.includes("#")) {
    if (screenAt(href.split("?")[0]!)) return href;
  }
  const query = new URLSearchParams(search);
  query.delete("returnTo");
  return `${SHELL_PATH}${query.size ? `?${query}` : ""}`;
}

export function settingsHref(page: SettingsPage, returnTo: string) {
  return `${settingsPages[page]}?${new URLSearchParams({ returnTo })}`;
}

export type AppSearchParams = Record<string, string | string[] | undefined>;

export function appHref(searchParams: AppSearchParams) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) value.forEach((part) => query.append(key, part));
    else if (value !== undefined) query.set(key, value);
  }
  const search = query.toString();
  return `${SHELL_PATH}${search ? `?${search}` : ""}`;
}
