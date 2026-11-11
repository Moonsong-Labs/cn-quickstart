# How to review

`REVIEW.md` says what to look for in each area. This file says how to write the review, and adds two checks that apply once per pull request.

## Tone

Be brief and concrete. Lead each comment with its severity and the consequence. Skip praise, restated diffs, and anything Biome already enforces: formatting and import order.

Use the labels in `REVIEW.md`: **Blocker**, **Should fix**, **Nit**. Post at most three nits, and none on a file the pull request is deleting. A nit is naming, wording, or structure. Do not file formatting as a nit.

For a blocker or a should-fix, show how the bug happens when that is clearer than describing it, in the form `REVIEW.md` specifies.

## Once per review: risk and decisions

Read the "Risk" and "Decisions for a person" sections of the pull request description against the diff. Comment once, on the description, when any of these holds:

1. Risk is rated low or medium, but the diff changes `quickstart/daml/licensing/**`, signing, auth, ledger writes, or `quickstart/common/openapi.yaml`.
2. Decisions says "None", but the diff makes a choice `REVIEW.md` marks as needing care, such as a new controller or a consuming choice.
3. A decision references a path the diff does not touch.
4. The decisions list restates the changed files rather than naming choices.

Name the section and the reason. Say nothing when the sections match the diff.

## Once per review: tests not weakened

Look only at test files: `quickstart/cli/test/**`, `quickstart/integration-test/**`, `quickstart/daml/licensing-tests/**`, and `**/*.test.ts`.

Comment once when the pull request deletes an assertion, loosens an expected value, adds a skip or `only`, raises a timeout, or deletes a test, and the description does not explain why. Say nothing when the pull request adds tests or changes no tests.
