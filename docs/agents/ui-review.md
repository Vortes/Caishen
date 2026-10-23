# UI review and E2E approval

## Build the interface

Before building or changing UI, read the [design system](../design-system/DESIGN.md) and the topic file for each component you use.

Start looking for page entry points in `src/app/`, interface components in `src/components/`, and styling in `src/styles/`. Trace the feature in the live app and code to discover what it actually uses.

## Present before E2E execution

1. Finish the proposed UI and present it in the live app shell with a direct feature link, screenshots of the changes, and brief notes on what to try.
2. Obtain explicit user sign-off for E2E execution against that presented version and the agreed coverage. A general instruction to build or verify a feature is not E2E approval.

Before sign-off, prepare test changes according to the [testing guide](testing.md). Type checking, linting, formatting, relevant unit tests, production builds, and manual browser inspection are allowed as needed. Browser automation may inspect the UI and capture review screenshots; it must not execute E2E scenarios.

Do not run E2E tests during UI iteration or before approval. This includes targeted Playwright specs, full suites, and tests launched by delegated agents or CI.

## Run approved coverage

After sign-off, run the agreed E2E coverage and necessary failure reruns. Test-only fixes and reruns against unchanged UI remain covered. If the UI changes, present the updated version and obtain renewed sign-off before running more E2E tests.

In delegated tasks and handoffs, include the approval gate, current approval status, presented version, and approved coverage. Until approval arrives, report E2E verification as pending user sign-off.
