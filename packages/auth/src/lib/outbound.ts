import { lookup } from "node:dns/promises";

import { createOutbound } from "@notes-learning/domain";

/** Production adapter shared by OIDC discovery, token exchange, and JWKS. */
export const outbound = createOutbound({
  fetch: (input, init) => globalThis.fetch(input, init),
  lookup: async (hostname) =>
    (await lookup(hostname, { all: true, verbatim: true })).map((row) => row.address),
});
