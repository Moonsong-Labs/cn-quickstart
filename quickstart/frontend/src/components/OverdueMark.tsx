// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

/** A red mark after a date whose deadline has passed. Screen readers announce it in words. */
export function OverdueMark() {
  return (
    <>
      <span
        aria-hidden="true"
        className="ml-1 font-bold text-danger-solid"
      >
        !
      </span>
      <span className="sr-only">Deadline passed</span>
    </>
  );
}
