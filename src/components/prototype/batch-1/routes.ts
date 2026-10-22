const BASE = "/prototype/batch-1";

export const WELCOME_PATH = `${BASE}/welcome`;
export const ONBOARDING_PATH = `${BASE}/onboarding`;
export const SETTINGS_PATH = `${BASE}/settings`;
export const UNSUBSCRIBE_PATH = `${BASE}/unsubscribe`;
export const BANK_OAUTH_PATH = `${BASE}/bank-oauth`;
export const LOAD_ERROR_PATH = `${BASE}/load-error`;

export type SettingsPage =
  "profile" | "appearance" | "partner" | "notifications";

export const settingsPath = (page: SettingsPage) =>
  page === "profile" ? SETTINGS_PATH : `${SETTINGS_PATH}/${page}`;
