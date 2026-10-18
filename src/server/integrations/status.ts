export interface IntegrationServiceStatus {
  name: string;
  status: "configured" | "not configured";
  detail: string;
}

export function integrationStatus(
  environment: Record<string, string | undefined>,
): IntegrationServiceStatus[] {
  const describe = (
    name: string,
    required: string[],
    ready: string,
  ): IntegrationServiceStatus => {
    const missing = required.filter((key) => !environment[key]?.trim());
    return {
      name,
      status: missing.length ? "not configured" : "configured",
      detail: missing.length ? `Missing ${missing.join(", ")}.` : ready,
    };
  };
  const plaid = describe(
    "Plaid",
    [
      "PLAID_CLIENT_ID",
      "PLAID_SECRET",
      "PLAID_ENV",
      "BANK_TOKEN_ENCRYPTION_KEY",
    ],
    "Credentials are present. Connect an eligible institution to verify live access; bank updates are periodic.",
  );
  if (
    environment.PLAID_ENV &&
    !["sandbox", "production"].includes(environment.PLAID_ENV)
  ) {
    plaid.status = "not configured";
    plaid.detail = "PLAID_ENV must be sandbox or production.";
  }
  if (environment.PLAID_ENV === "sandbox" && plaid.status === "configured")
    plaid.detail =
      "Sandbox credentials are present. Sandbox connections use test bank data and do not connect real accounts.";
  if (
    environment.BANK_TOKEN_ENCRYPTION_KEY &&
    !/^[a-f0-9]{64}$/i.test(environment.BANK_TOKEN_ENCRYPTION_KEY)
  ) {
    plaid.status = "not configured";
    plaid.detail =
      "BANK_TOKEN_ENCRYPTION_KEY must contain 32 random bytes encoded as 64 hex characters.";
  }
  return [
    describe(
      "Clerk profile sync",
      ["CLERK_WEBHOOK_SIGNING_SECRET"],
      "Signed webhook handling is configured. Register user.created, user.updated, and user.deleted at /api/webhooks/clerk in Clerk; first authenticated requests also create local identity records.",
    ),
    plaid,
    describe(
      "OpenRouter",
      ["OPENROUTER_API_KEY", "OPENROUTER_MODEL"],
      "Credentials and model are present. Suggestions still require review; model access has not been verified.",
    ),
    describe(
      "Daily email",
      ["RESEND_API_KEY", "EMAIL_FROM", "APP_BASE_URL"],
      "Email configuration is present. Sender verification and delivery must be verified with the provider.",
    ),
    describe(
      "Hosted daily updates",
      ["CRON_SECRET"],
      "Cron authentication is configured. A deployed scheduler must invoke the protected endpoint independently of your computer.",
    ),
  ];
}
