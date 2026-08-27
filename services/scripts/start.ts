/**
 * Railway entrypoint dispatcher.
 *
 * All Clearline services deploy from the same root (services/), so one start
 * script picks the process by the SERVICE_ROLE env var:
 *   SERVICE_ROLE=signer   -> signer service (watches + signs instructions)
 *   SERVICE_ROLE=custodian-> mock custodian / settlement relayer
 * A missing/unknown role defaults to signer and logs loudly.
 *
 * Compiled by tsc to dist/scripts/start.js; runs under plain `node` at runtime
 * (no tsx/ts-node dependency in production).
 */

const role = (process.env.SERVICE_ROLE ?? "signer").toLowerCase();

// Relative to this file's compiled location (dist/scripts/): the workspace
// sources live one level up at dist/{signer,custodian}/src/index.js.
if (role === "custodian") {
  require("../custodian/src/index");
} else {
  require("../signer/src/index");
}

// Provide a visible one-liner before the child module's own boot logs.
// eslint-disable-next-line no-console
console.log(`[dispatch] starting Clearline ${role} service`);

