import {
  addMember,
  bookSchema,
  counterpartyId,
  createBook,
  execute,
  pairedEnvelopeId,
  projectBook,
  withCounterpartyAccounts,
  type Command,
  type Target,
} from "~/domain/engine";
import { partnerEntryId } from "~/domain/partner-ledger";
type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : never;
export type SeedOperation = {
  actorId: string;
  source: "user" | "agent";
  command: Command;
};

export function shiftMonth(month: string, offset: number): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

export function developmentToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

const categories = [
  ["rent", "Rent", "Home"],
  ["utilities", "Utilities & internet", "Home"],
  ["groceries", "Groceries", "Everyday"],
  ["dining", "Dining & coffee", "Everyday"],
  ["transport", "Gas & transit", "Everyday"],
  ["subscriptions", "Subscriptions", "Everyday"],
  ["health", "Medical & pharmacy", "True expenses"],
  ["shopping", "Clothing & home", "True expenses"],
  ["insurance", "Annual insurance", "True expenses"],
  ["registration", "Car registration", "True expenses"],
  ["travel", "Travel", "Goals"],
  ["emergency", "Emergency fund", "Goals"],
  ["work", "Work travel", "True expenses"],
  ["gifts", "Gifts", "True expenses"],
  ["weekend", "Weekend projects", "True expenses"],
] as const;

export function buildDevelopmentSeed({
  userId,
  partnerId,
  asOf = developmentToday(),
}: {
  userId: string;
  partnerId: string;
  asOf?: string;
}) {
  if (userId === partnerId)
    throw new Error("Choose two different participants.");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
    new Date(`${asOf}T00:00:00Z`).toISOString().slice(0, 10) !== asOf
  )
    throw new Error("Use a valid YYYY-MM-DD seed date.");
  const month = asOf.slice(0, 7);
  const firstMonth = shiftMonth(month, -2);
  let book = withCounterpartyAccounts(
    addMember(
      createBook(userId, "Demo · Alex’s budget", firstMonth),
      partnerId,
      "Demo · Jordan’s budget",
      firstMonth,
    ),
  );
  const operations: SeedOperation[] = [];
  const run = (
    actorId: string,
    input: WithoutId<Command>,
    source: "user" | "agent" = "user",
  ) => {
    const command: Command = {
      ...input,
      id: `dev-seed:${operations.length + 1}`,
    };
    book = execute(book, actorId, command, source);
    operations.push({ actorId, source, command });
  };
  const date = (period: string, day: number) => {
    const limit = period === month ? Number(asOf.slice(8)) : 28;
    return `${period}-${String(Math.min(day, limit)).padStart(2, "0")}`;
  };
  const partner = counterpartyId("partner");
  const reimbursements = counterpartyId("reimbursements");
  // A purchase line shared with a counterparty, recorded when it was made.
  const share = (
    period: string,
    day: number,
    accountId: string,
    amount: number,
    counterpartyName?: string,
  ) => ({
    counterpartyShare: { accountId, amount, counterpartyName },
    recordedAt: `${date(period, day)}T20:00:00.000Z`,
  });
  // The non-payer's side of a shared purchase, in their own category.
  const categorizeSide = (
    payerId: string,
    transactionId: string,
    categoryId: string,
  ) =>
    run(payerId === userId ? partnerId : userId, {
      type: "partner.categorize",
      entryId: partnerEntryId(payerId, transactionId, transactionId),
      categoryId,
    });
  // A payment between the partners, as both banks' imports record it.
  const settle = (
    settlementId: string,
    payerId: string,
    settledOn: string,
    amount: number,
    method: string,
    confirmed: boolean,
  ) => {
    const recipientId = payerId === userId ? partnerId : userId;
    run(
      payerId,
      {
        type: "partner.settle",
        settlementId,
        method,
        legs: [
          {
            userId: payerId,
            accountId: "checking",
            date: settledOn,
            amount: -amount,
            payee: `${method} payment`,
          },
          {
            userId: recipientId,
            accountId: "checking",
            date: settledOn,
            amount,
            payee: `${method} payment received`,
          },
        ],
      },
      "agent",
    );
    if (confirmed)
      run(recipientId, { type: "partner.settlement.confirm", settlementId });
  };
  const buy = (
    actorId: string,
    period: string,
    day: number,
    transactionId: string,
    payee: string,
    amount: number,
    categoryId?: string,
    accountId = "checking",
    extra: Partial<Extract<Command, { type: "transaction.upsert" }>> = {},
    source: "user" | "agent" = "user",
  ) =>
    run(
      actorId,
      {
        type: "transaction.upsert",
        transactionId,
        accountId,
        date: date(period, day),
        amount: -amount,
        payee,
        categoryId,
        ...extra,
      },
      source,
    );
  const target = (
    actorId: string,
    categoryId: string,
    value: Omit<Target, "snoozedMonths">,
  ) =>
    run(actorId, {
      type: "target.set",
      categoryId,
      target: { ...value, snoozedMonths: [] },
    });

  for (const [index, actorId] of [userId, partnerId].entries()) {
    run(actorId, {
      type: "settings.update",
      timezone: "America/Los_Angeles",
      emailEnabled: false,
      emailHour: index ? 9 : 8,
    });
    for (const [accountId, name, kind, openingBalance] of [
      [
        "checking",
        index ? "Demo · Chase checking" : "Demo · Chase Total Checking",
        "cash",
        index ? 620000 : 850000,
      ],
      ["savings", "Demo · Discover savings", "cash", index ? 800000 : 1250000],
      ["amex", "Demo · American Express", "credit", index ? -22000 : -42500],
      ["discover", "Demo · Discover It", "credit", -18000],
    ] as const)
      run(actorId, {
        type: "account.add",
        accountId,
        name,
        kind,
        openingBalance,
        date: `${firstMonth}-01`,
      });
    run(actorId, {
      type: "category.import",
      categories: categories.map(([categoryId, name, group]) => ({
        categoryId,
        name,
        group,
      })),
    });
    run(actorId, {
      type: "loan.add",
      loanId: "student",
      categoryId: "student-payment",
      name: "Nelnet student loan",
      principal: index ? 1850000 : 2450000,
      annualRateBps: 625,
      minimumPayment: 32000,
      variable: true,
      effectiveDate: `${firstMonth}-01`,
    });
    run(actorId, {
      type: "loan.add",
      loanId: "personal",
      categoryId: "personal-payment",
      name: "SoFi personal loan",
      principal: 680000,
      annualRateBps: 1125,
      minimumPayment: 24500,
      variable: false,
      effectiveDate: `${firstMonth}-01`,
    });
    for (const [categoryId, amount, behavior] of [
      ["rent", index ? 260000 : 130000, "refill"],
      ["dining", 25000, "refill"],
      ["travel", 35000, "contribution"],
    ] as const)
      target(actorId, categoryId, {
        cadence: "monthly",
        behavior,
        amount,
        startMonth: firstMonth,
      });
    target(actorId, "groceries", {
      cadence: "weekly",
      behavior: "refill",
      amount: 15000,
      weekday: 6,
      startMonth: firstMonth,
    });
    target(actorId, "insurance", {
      cadence: "yearly",
      behavior: "refill",
      amount: 120000,
      startMonth: firstMonth,
      dueDate: `${shiftMonth(month, 8)}-15`,
    });
    target(actorId, "registration", {
      cadence: "custom",
      behavior: "contribution",
      amount: 36000,
      startMonth: firstMonth,
      dueDate: `${shiftMonth(month, 4)}-15`,
      repeatEvery: 12,
      repeatUnit: "months",
    });
    target(actorId, "emergency", {
      cadence: "custom",
      behavior: "balance",
      amount: 500000,
      startMonth: firstMonth,
      dueDate: `${shiftMonth(month, 10)}-01`,
    });
    target(actorId, "card:amex", {
      cadence: "card-monthly",
      behavior: "contribution",
      amount: 20000,
      startMonth: firstMonth,
    });
    target(actorId, "card:discover", {
      cadence: "card-payoff",
      behavior: "contribution",
      amount: 0,
      startMonth: firstMonth,
      dueDate: `${shiftMonth(month, 6)}-01`,
    });
  }
  for (let offset = -2; offset <= 0; offset++) {
    const period = shiftMonth(month, offset);
    const current = offset === 0;
    const suffix = period;
    for (const [index, actorId] of [userId, partnerId].entries()) {
      for (const day of [1, 15]) {
        if (current && day > Number(asOf.slice(8))) continue;
        run(actorId, {
          type: "transaction.upsert",
          transactionId: `salary-${suffix}-${day}`,
          accountId: "checking",
          date: date(period, day),
          amount: index ? 285000 : 325000,
          payee: index ? "Northstar Design · payroll" : "Cedar Labs · payroll",
        });
      }
      run(actorId, {
        type: "transaction.upsert",
        transactionId: `interest-${suffix}`,
        accountId: "savings",
        date: date(period, 1),
        amount: index ? 1762 : 2487,
        payee: "Discover · savings interest",
      });
      const funding: Record<string, number> = {
        rent: 130000,
        utilities: index ? 15000 : 25000,
        groceries: 60000,
        dining: 25000,
        transport: 20000,
        subscriptions: 8000,
        health: current ? 5000 : 3000,
        shopping: 15000,
        insurance: 10000,
        registration: 6000,
        travel: 35000,
        emergency: 50000,
        work: 5000,
        gifts: 5000,
        "student-payment": 32000,
        "personal-payment": 24500,
        "card:amex": 20000,
        "card:discover": 8000,
      };
      // Float in the People envelopes: cash set aside for what each fronts
      // for the other until it's paid back.
      if (offset === -2) {
        funding[pairedEnvelopeId("partner")] = index ? 130000 : 25000;
        if (!index) funding[pairedEnvelopeId("reimbursements")] = 60000;
      }
      for (const [categoryId, amount] of Object.entries(funding))
        run(actorId, { type: "assign", categoryId, amount, month: period });
      for (const [day, payee, amount, categoryId, accountId] of [
        [3, "Chevron", 5287, "transport", "amex"],
        [5, "Netflix", 1799, "subscriptions", "amex"],
        [6, "Spotify", 1199, "subscriptions", "amex"],
        [7, "Target", 6500, "shopping", "checking"],
        [8, "CVS Pharmacy", 2486, "health", "checking"],
        [11, "SFMTA · Clipper", 3000, "transport", "checking"],
        [14, "PG&E autopay", 7619, "utilities", "checking"],
        [18, "Apple iCloud+", 299, "subscriptions", "amex"],
        [22, "Bookshop.org", 2389, "gifts", "discover"],
      ] as const) {
        if (current && day > Number(asOf.slice(8))) continue;
        buy(
          actorId,
          period,
          day,
          `${index}-${payee}-${suffix}`,
          payee,
          amount + (categoryId === "transport" ? (offset + 2) * 37 : 0),
          categoryId,
          accountId,
        );
      }
      for (
        let day = 2;
        day <= (current ? Number(asOf.slice(8)) : 28);
        day += 3
      ) {
        buy(
          actorId,
          period,
          day,
          `coffee-${index}-${suffix}-${day}`,
          ["Blue Bottle Coffee", "Andytown Coffee", "Tartine Bakery"][day % 3]!,
          475 + ((day * 31 + index * 47) % 640),
          "dining",
          "amex",
        );
      }
      buy(
        actorId,
        period,
        9,
        `dinner-${index}-${suffix}`,
        "Nopa · dinner",
        8640,
        "dining",
        "amex",
      );
      run(actorId, {
        type: "transaction.upsert",
        transactionId: `register-payment-1:${date(period, 12)}:student`,
        loanId: "student",
        date: date(period, 12),
        interest: 12775,
        accountId: "checking",
        amount: -(19225 + 12775),
        payee: "Loan payment",
        status: "posted",
      });
      run(actorId, {
        type: "transaction.upsert",
        transactionId: `register-payment-2:${date(period, 13)}:personal`,
        loanId: "personal",
        date: date(period, 13),
        interest: 6375,
        accountId: "checking",
        amount: -(18125 + 6375),
        payee: "Loan payment",
        status: "posted",
      });
    }
    if (current) {
      buy(
        userId,
        period,
        1,
        "household-stock-up",
        "Costco · household stock-up",
        28000,
        "groceries",
        "checking",
        share(period, 1, partner, 14000),
      );
      categorizeSide(userId, "household-stock-up", "groceries");
      settle(
        "partner-payment-awaiting-confirmation",
        partnerId,
        date(period, 1),
        12000,
        "Venmo",
        false,
      );
    }
    buy(
      partnerId,
      period,
      2,
      `rent-${suffix}`,
      "Parkside Apartments · rent",
      260000,
      "rent",
      "checking",
      share(period, 2, partner, 130000),
    );
    categorizeSide(partnerId, `rent-${suffix}`, "rent");
    buy(
      userId,
      period,
      3,
      `utilities-${suffix}`,
      "Sonic · internet & utilities",
      18942,
      "utilities",
      "checking",
      share(period, 3, partner, 9471),
    );
    categorizeSide(userId, `utilities-${suffix}`, "utilities");
    buy(
      userId,
      period,
      4,
      `groceries-a-${suffix}`,
      "Trader Joe’s",
      12346,
      "groceries",
      "amex",
      share(period, 4, partner, 6173),
    );
    if (!current) categorizeSide(userId, `groceries-a-${suffix}`, "groceries");
    buy(
      partnerId,
      period,
      5,
      `groceries-b-${suffix}`,
      "Whole Foods Market",
      8793,
      "groceries",
      "amex",
      share(period, 5, partner, 3000),
    );
    categorizeSide(partnerId, `groceries-b-${suffix}`, "groceries");
    if (!current) {
      // Settle up each month: whoever owes pays the Partner balance.
      const owedToYou = projectBook(book, userId, period).accounts.find(
        (account) => account.id === partner,
      )!.balance;
      if (owedToYou)
        settle(
          `settlement-${suffix}`,
          owedToYou > 0 ? partnerId : userId,
          date(period, 20),
          Math.abs(owedToYou),
          "Zelle",
          true,
        );
    }
    if (current) break;
    for (const actorId of [userId, partnerId])
      run(actorId, {
        type: "transaction.upsert",
        transactionId: `register-payment-3:${date(period, 27)}`,
        date: date(period, 27),
        accountId: "checking",
        transferAccountId: "amex",
        amount: -35000,
        payee: "Credit card payment",
        status: "posted",
      });
  }

  run(userId, {
    type: "target.snooze",
    categoryId: "travel",
    month,
    currentMonth: month,
    snoozed: true,
  });
  run(userId, {
    type: "loan.rate",
    loanId: "student",
    annualRateBps: 675,
    effectiveDate: date(month, 1),
  });
  buy(
    userId,
    month,
    6,
    "conference-hotel",
    "Hyatt Regency · work conference",
    48000,
    "work",
    "amex",
    share(month, 6, reimbursements, 48000, "Cedar Labs"),
  );
  const repaid = (day: number, amount: number) =>
    run(userId, {
      type: "counterparty.receive",
      counterpartyAccountId: reimbursements,
      cashAccountId: "checking",
      date: date(month, day),
      amount,
      counterpartyName: "Cedar Labs",
      recordedAt: `${date(month, day)}T20:00:00.000Z`,
    });
  repaid(10, 20000);
  buy(
    userId,
    month,
    7,
    "work-train",
    "Amtrak · client visit",
    8500,
    "work",
    "checking",
    share(month, 7, reimbursements, 8500, "Cedar Labs"),
  );
  repaid(11, 8500);
  buy(
    userId,
    month,
    5,
    "amex-offer-purchase",
    "REI · hiking gear",
    12000,
    "shopping",
    "amex",
  );
  run(userId, {
    type: "transaction.upsert",
    transactionId: `register-payment-4:${date(month, 12)}`,
    date: date(month, 12),
    accountId: "amex",
    amount: 1000,
    payee: "Posted statement credit",
    status: true ? "posted" : "pending",
  });
  run(userId, {
    type: "transaction.upsert",
    transactionId: "target-refund",
    accountId: "checking",
    date: date(month, 11),
    amount: 1500,
    payee: "Target · returned household item",
    categoryId: "shopping",
  });
  buy(
    userId,
    month,
    14,
    "urgent-care",
    "One Medical · urgent care",
    14300,
    "health",
  );
  buy(
    userId,
    month,
    15,
    "headphones",
    "Best Buy · headphones",
    17300,
    "shopping",
    "discover",
  );
  buy(
    userId,
    month,
    8,
    "restaurant-updated",
    "Burma Superstar",
    7200,
    "dining",
    "amex",
    { status: "pending" },
    "agent",
  );
  buy(
    userId,
    month,
    9,
    "restaurant-updated",
    "Burma Superstar",
    8640,
    "dining",
    "amex",
    { status: "posted" },
    "agent",
  );
  run(userId, {
    type: "transaction.approve",
    transactionIds: ["restaurant-updated"],
  });
  buy(
    userId,
    month,
    10,
    "birthday-dinner",
    "Boulevard · birthday dinner",
    39000,
    "dining",
    "amex",
  );
  buy(
    userId,
    month,
    10,
    "duplicate-original",
    "Costco · household supplies",
    7500,
    "shopping",
  );
  buy(
    userId,
    month,
    10,
    "duplicate-copy",
    "Costco · household supplies",
    7500,
    "shopping",
  );
  run(userId, {
    type: "transaction.merge",
    transactionId: "duplicate-original",
    duplicateId: "duplicate-copy",
  });
  buy(
    userId,
    month,
    11,
    "voided-charge",
    "Walgreens · voided charge",
    2700,
    "health",
  );
  run(userId, { type: "transaction.remove", transactionId: "voided-charge" });
  buy(
    userId,
    month,
    12,
    "review-groceries",
    "Safeway",
    5823,
    "groceries",
    "amex",
    {},
    "agent",
  );
  buy(
    userId,
    month,
    13,
    "review-transit",
    "BART · Clipper",
    2450,
    "transport",
    "checking",
    {},
    "agent",
  );
  buy(
    userId,
    month,
    14,
    "uncategorized",
    "SQ *NEIGHBORHOOD MARKET",
    3742,
    undefined,
    "checking",
    {},
    "agent",
  );
  run(userId, {
    type: "transaction.categorize",
    transactionId: "uncategorized",
    categoryId: "groceries",
  });
  run(userId, {
    type: "transaction.approve",
    transactionIds: ["review-groceries", "review-transit"],
  });
  buy(
    userId,
    month,
    16,
    "pending-dining",
    "OpenTable · restaurant authorization",
    6500,
    "dining",
    "amex",
    { status: "pending" },
  );
  run(userId, {
    type: "transaction.upsert",
    transactionId: "pending-payroll",
    accountId: "checking",
    date: asOf,
    amount: 325000,
    payee: "Cedar Labs · pending payroll",
    status: "pending",
  });
  const dining = projectBook(book, userId, month).categories.find(
    (category) => category.id === "dining",
  )!;
  if (dining.available < 0)
    run(userId, {
      type: "cover",
      fromCategoryId: "emergency",
      toCategoryId: "dining",
      month,
      amount: -dining.available,
    });
  settle(
    "current-partial-settlement",
    userId,
    date(month, 16),
    25000,
    "Zelle",
    true,
  );
  for (const actorId of [userId, partnerId])
    run(actorId, {
      type: "transaction.upsert",
      transactionId: `register-payment-5:${asOf}`,
      date: asOf,
      accountId: "checking",
      transferAccountId: "amex",
      amount: -30000,
      payee: "Credit card payment",
      status: "posted",
    });

  const parsed = bookSchema.parse(book);
  return {
    book: parsed,
    operations,
    month,
    firstMonth,
    asOf,
    userId,
    partnerId,
  };
}

export type DevelopmentSeed = ReturnType<typeof buildDevelopmentSeed>;
