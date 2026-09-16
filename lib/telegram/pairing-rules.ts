/**
 * Pairing rules, as pure functions.
 *
 * Deliberately imports nothing. The decision about who the bot will talk to is
 * the security boundary of a self-hosted Lore, so it has to be testable without
 * a database, an env file, or a running app.
 */

export interface Owner {
  chatId: string;
  username?: string;
  firstName?: string;
  boundAt: string;
}

export interface PairingCode {
  code: string;
  expiresAt: number;
}

export interface InboundState {
  owner: Owner | null;
  pending: PairingCode | null;
  now: number;
}

export type InboundDecision =
  | { allow: true }
  | { allow: false; reply: string | null; bind?: Owner; consumeCode?: boolean };

/**
 * The single gate every inbound message goes through, as a pure function so the
 * rules can be tested without a database. `gateInbound` below is the thin
 * wrapper that loads state and applies the result.
 *
 * The default is silence. Anything not explicitly allowed gets no reply, because
 * a reply confirms the bot is live and invites a stranger to keep poking.
 */
export function decideInbound(
  text: string,
  chat: { id: string | number; username?: string; firstName?: string },
  state: InboundState,
): InboundDecision {
  const chatId = String(chat.id);

  if (state.owner) {
    if (state.owner.chatId === chatId) return { allow: true };
    // Bound to someone else. Say nothing at all, including to a valid-looking code.
    return { allow: false, reply: null };
  }

  // /start 123456, or just the six digits on their own.
  const code = text.trim().match(/^(?:\/start\s+)?(\d{6})$/)?.[1];
  if (!code) {
    return {
      allow: false,
      reply: 'This bot is not paired yet. Open Lore, start pairing in Settings, and send me the six digit code.',
    };
  }

  if (!state.pending) {
    return { allow: false, reply: 'No pairing in progress. Open Lore, go to Settings, and start pairing to get a code.' };
  }
  if (state.now > state.pending.expiresAt) {
    return { allow: false, reply: 'That code expired. Generate a new one in Lore and try again.', consumeCode: true };
  }
  if (state.pending.code !== code) {
    // Burn the code on a wrong guess so an attacker gets one try per window.
    return { allow: false, reply: 'That code is not right. Generate a new one in Lore and try again.', consumeCode: true };
  }

  return {
    allow: false,
    reply: 'Paired. This Lore is yours now, and the bot will ignore everyone else. Say anything to get started.',
    bind: {
      chatId,
      username: chat.username,
      firstName: chat.firstName,
      boundAt: new Date(state.now).toISOString(),
    },
    consumeCode: true,
  };
}

