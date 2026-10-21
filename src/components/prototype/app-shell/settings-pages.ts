// Settings open over the shell at their own address, so they can be linked
// and the browser's Back button closes them.
export const SHELL_PATH = "/prototype/app-shell";
const SETTINGS_PATH = `${SHELL_PATH}/settings`;

export type SettingsPage = "profile" | "appearance" | "partner";

export const settingsPages: Record<SettingsPage, string> = {
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
