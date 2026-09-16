/**
 * `npm run relay:connect` connects this install to the shared relay.
 *
 * The relay lends X lookups, voice and the template library to installs that
 * have not set their own keys, on limited free credits. Running this twice is
 * safe: an install that already has a key just prints its balance.
 * Set LORE_RELAY=off to opt out entirely.
 */
try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local yet, the environment may already carry what we need.
}

async function main() {
  const { connectRelay, relayTurnedOff } = await import('../lib/relay/client');

  if (relayTurnedOff()) {
    console.log('The shared relay is turned off with LORE_RELAY=off, so there is nothing to connect.');
    return;
  }

  const { credits } = await connectRelay();
  console.log(`Connected to the shared relay, ${credits} credits.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`Could not connect to the shared relay: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
