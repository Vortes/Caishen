const BASE = "/prototype/batch-1";

export const WELCOME_PATH = `${BASE}/welcome`;
export const ONBOARDING_PATH = `${BASE}/onboarding`;
export const SETTINGS_PATH = `${BASE}/settings`;
export const UNSUBSCRIBE_PATH = `${BASE}/unsubscribe`;
export const BANK_OAUTH_PATH = `${BASE}/bank-oauth`;
export const LOAD_ERROR_PATH = `${BASE}/load-error`;

export type SettingsPage = "profile" | "appearance" | "partner";

export const settingsPath = (page: SettingsPage) =>
  page === "profile" ? SETTINGS_PATH : `${SETTINGS_PATH}/${page}`;

// Where the unsubscribe page sends people to change the email.
export const DAILY_EMAIL_PATH = `${SETTINGS_PATH}#daily-email`;
