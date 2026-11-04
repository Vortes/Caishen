// Next's dev worker forwards only one --import value. Load both HTTP
// fixtures in order so the email wrapper retains the Plaid wrapper.
await import("./plaid-fetch-fixture.mjs");
await import("./resend-fetch-fixture.mjs");
