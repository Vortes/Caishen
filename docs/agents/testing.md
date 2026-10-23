# Testing

Use the `tdd` skill for every new or changed test, from domain tests through E2E tests. E2E tests are exempt from test-first ordering; their execution follows the [UI review and approval gate](ui-review.md).

## Agree on the seam

Before writing any test, propose the public boundary to test and explain what it catches and misses. Write tests only at seams the user has confirmed. Existing coverage under `tests/` can help locate candidate seams; inspect the public interface before choosing one.

## Test behavior

Test through public interfaces. Do not mock internal collaborators, test private functions, verify through side channels, or recompute expected values the way the code does.

## Non-E2E tests

Write one failing test, run it, and confirm that it fails for the expected reason. Write only enough implementation to pass it, then repeat one vertical slice at a time. Report the red and green runs for each new test.

## E2E tests

Prepare test changes at confirmed seams, then run them only after the UI version and coverage receive explicit user sign-off. An E2E test does not need to fail before implementation. Report actual run results; do not require or claim a red run for an already working feature.

## Delegation and handoffs

Include these testing rules and the E2E ordering exception in delegated tasks and handoffs. For E2E work, also carry the approval gate, current approval status, presented UI version, and approved coverage from the [UI review guide](ui-review.md).
