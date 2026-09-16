import { decideInbound, type InboundState } from '../lib/telegram/pairing-rules';

const NOW = 1_760_000_000_000;
const OWNER = { chatId: '111', username: 'owner', boundAt: new Date(NOW).toISOString() };
const LIVE = { code: '654321', expiresAt: NOW + 60_000 };

const owner = (c: string | number) => ({ id: c, username: 'someone' });
const state = (o: Partial<InboundState> = {}): InboundState =>
  ({ owner: null, pending: null, now: NOW, ...o });

let failed = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? '  ok  ' : ' FAIL '}${name}`);
  if (!cond) failed++;
}

// --- once paired -----------------------------------------------------------
const asOwner = decideInbound('hey', owner(111), state({ owner: OWNER }));
check('owner is allowed through', asOwner.allow === true);

const stranger = decideInbound('hey', owner(999), state({ owner: OWNER }));
check('stranger is blocked', stranger.allow === false);
check('stranger gets NO reply (bot stays silent)', stranger.allow === false && stranger.reply === null);

const strangerWithCode = decideInbound('/start 654321', owner(999), state({ owner: OWNER, pending: LIVE }));
check('stranger cannot pair over an existing owner', strangerWithCode.allow === false && !('bind' in strangerWithCode && strangerWithCode.bind));
check('stranger with a valid code still gets silence', strangerWithCode.allow === false && strangerWithCode.reply === null);

// --- before pairing --------------------------------------------------------
const unpaired = decideInbound('hello?', owner(222), state());
check('unpaired install explains itself', unpaired.allow === false && !!unpaired.reply?.includes('not paired'));

const noPending = decideInbound('123456', owner(222), state());
check('code with no pairing in progress is refused', noPending.allow === false && !('bind' in noPending && noPending.bind));

const expired = decideInbound('/start 654321', owner(222), state({ pending: { code: '654321', expiresAt: NOW - 1 } }));
check('expired code refused', expired.allow === false && !('bind' in expired && expired.bind));
check('expired code is consumed', expired.allow === false && expired.consumeCode === true);

const wrong = decideInbound('/start 000000', owner(222), state({ pending: LIVE }));
check('wrong code refused', wrong.allow === false && !('bind' in wrong && wrong.bind));
check('wrong code burns the code (one guess per window)', wrong.allow === false && wrong.consumeCode === true);

// --- the happy path --------------------------------------------------------
const paired = decideInbound('/start 654321', owner(222), state({ pending: LIVE }));
check('valid code binds the chat', paired.allow === false && paired.bind?.chatId === '222');
check('binding consumes the code', paired.allow === false && paired.consumeCode === true);

const bare = decideInbound('654321', owner(333), state({ pending: LIVE }));
check('bare six digits also pair (no /start needed)', bare.allow === false && bare.bind?.chatId === '333');

const spaced = decideInbound('  /start   654321  ', owner(444), state({ pending: LIVE }));
check('whitespace tolerated', spaced.allow === false && spaced.bind?.chatId === '444');

// --- things that must NOT look like a code ---------------------------------
for (const junk of ['12345', '1234567', 'code 654321', '654321 please', '/start']) {
  const r = decideInbound(junk, owner(555), state({ pending: LIVE }));
  check(`"${junk}" does not pair`, r.allow === false && !('bind' in r && r.bind));
}

console.log(failed ? `\n${failed} failing\n` : '\nall pairing rules hold\n');
process.exit(failed ? 1 : 0);
