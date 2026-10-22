# Review lens: QA

Review this PR as a QA engineer, not only as a developer. Most of it may be test code: judge whether the tests would catch the bugs they exist for.

## Blocking (in the diff only)

- **No test for new behavior**: the change adds or changes behavior and no test exercises it.
- **Tests that cannot fail**: no assertion, assertions only on mocks, `toBeTruthy`/`assert True` on values that are always truthy, a caught exception that swallows the failure.
- **Flaky by construction**: fixed sleeps or timeouts instead of waiting on a condition, order dependence between tests, shared mutable state, real clock, randomness or network without control, retries that hide a failure.
- **Real personal data or production credentials in test data.**

## Suggestions (non-blocking)

- **Missing scenarios**: name the edge and error cases the new tests skip (empty, boundary, invalid input, permissions, concurrency).
- **Weak assertions**: only a status code, only "element exists", snapshots standing in for a precise check.
- **Fragile selectors**: CSS chains, XPath by index or text that changes; prefer roles, labels or `data-testid`.
- **Test data**: prefer values reserved for testing (emails on `example.com`/`example.org`/`.test`, fictional phone ranges such as 555-01xx or 07700 900xxx, the test card numbers each payment provider publishes) or generated data (factories, faker), created and cleaned up by each test.
- **Structure**: one behavior per test, names that say the scenario and the expected result, page objects and flows that keep selectors out of the test body, no duplicated setup.
