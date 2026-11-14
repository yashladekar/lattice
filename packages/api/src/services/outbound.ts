import { lookup } from "node:dns/promises";

import { createOutbound } from "@notes-learning/domain";

/**
 * Production adapter for the shared outbound policy. Webhooks, URL previews,
 * SSO, and the configured AI provider all use this instance so DNS answers,
 * schemes, redirects, and timeouts are checked in one place.
 */
export const outbound = createOutbound({
  fetch: (input, init) => globalThis.fetch(input, init),
  lookup: async (hostname) =>
    (await lookup(hostname, { all: true, verbatim: true })).map((row) => row.address),
});
