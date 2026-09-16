/**
 * `npm run relay:connect` connects this install to the shared relay.
 *
 * The relay makes X lookups, voice and transcription calls for installs that
 * have not set their own keys. Its free credits unlock after a follow on X. Running this twice is
 * safe: an install that already has a key just prints its balance.
 * Set LORE_RELAY=off to opt out entirely.
 */
import '../lib/load-env';

async function main() {
  const { connectRelay, relayBalance, relayTurnedOff } = await import('../lib/relay/client');

  if (relayTurnedOff()) {
    console.log('The shared relay is turned off with LORE_RELAY=off, so there is nothing to connect.');
    return;
  }

  const { credits } = await connectRelay();
  const balance = await relayBalance().catch(() => null);
  if (balance && !balance.unlocked) {
    console.log('Connected to the shared relay. Unlock your free credits on the setup page, under Extras.');
  } else {
    console.log(`Connected to the shared relay, ${credits} credits.`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(`Could not connect to the shared relay: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
