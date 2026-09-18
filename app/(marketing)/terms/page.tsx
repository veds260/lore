import type { Metadata } from 'next';
import Link from 'next/link';
import { Bullets, Code, LegalPage, Section } from '@/components/marketing/legal';
import { GITHUB_URL, X_URL } from '@/components/marketing/social';

export const metadata: Metadata = {
  title: 'Terms | Lore',
  description: 'The rules for using the hosted Lore service, and what it does and does not promise.',
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms"
      updated="18 September 2026"
      summary="This is a plain summary of the deal, written so you can check it against the code. It is not legal advice."
    >
      <Section heading="Who this is between">
        <p>
          The hosted service at trylore.xyz is run by one person, Vedaang Singh. Using it means you accept
          what is on this page. If you do not, the whole thing is open source, so you can run your own copy
          and none of this applies to you.
        </p>
      </Section>

      <Section heading="The code and the service are separate">
        <p>
          The code is licensed under AGPL-3.0, and the{' '}
          <Code>LICENSE</Code> file in the{' '}
          <Link href={GITHUB_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2">repository</Link>{' '}
          is what governs your use of it. You can read it, change it, and run it yourself. If you run a
          modified Lore as a service for other people, the licence says you have to publish your changes.
          This page only covers the hosted service.
        </p>
      </Section>

      <Section heading="Your account">
        <p>
          You need an account to use the hosted service. Keep the password to yourself, and tell us if you
          think someone else has it, and keep it to one person per account. You have to be old enough to
          agree to this where you live, which in most places means 13 or older, and 16 in parts of the EU.
        </p>
      </Section>

      <Section heading="Your content stays yours">
        <p>
          Your drafts, your posts, your notes and your voice document belong to you. We store them so the
          product works, and we do not sell them, publish them, or train a model on them. If you ask for
          your account to be deleted, they go with it, on the terms in the{' '}
          <Link href="/privacy" className="underline underline-offset-2">privacy page</Link>.
        </p>
      </Section>

      <Section heading="What you agree not to do">
        <Bullets
          items={[
            'Impersonate someone else, or use Lore to write as a person who has not asked you to.',
            'Feed it private data about other people that you have no right to hold.',
            'Use it for spam, harassment, scams, or anything illegal where you are.',
            'Break the rules of X, LinkedIn or anywhere else you publish what Lore drafts.',
            'Register extra accounts or extra installs to farm free relay credits.',
            'Attack the service: scraping it, hammering the API, or trying to reach other people’s data.',
          ]}
        />
        <p>
          Accounts and relay keys that do these things get revoked, usually without a warning first, since
          there is no support team to run an appeal.
        </p>
      </Section>

      <Section heading="Posting is on you">
        <p>
          Lore never posts by itself. Every draft ends at a button that opens X with the text filled in,
          and you press send. What you publish is yours, including anything a model got wrong, so read it
          before it goes out.
        </p>
      </Section>

      <Section heading="Model providers and the relay">
        <p>
          Lore sends your prompts to whichever model provider you connect, which today means Anthropic,
          OpenAI or OpenRouter. Their terms apply to that call, and their outages are their outages. The
          shared relay is a free convenience with a daily cap on it: credits, caps and the unlock steps can
          change at any time, and a key can be revoked if it is being abused. Your own API keys always take
          priority over the relay, and{' '}
          <Code>LORE_RELAY=off</Code> turns it off.
        </p>
      </Section>

      <Section heading="Availability, changes and shutdown">
        <p>
          There is no uptime promise. Features can change or disappear, and the hosted service can be shut
          down. If a shutdown is planned, you get notice at the email address on your account and a way to
          export what you have, and the self-hosted route stays open either way.
        </p>
        <p>
          If prices ever appear on the hosted service, they apply from when you agree to them, never
          retroactively.
        </p>
      </Section>

      <Section heading="Provided as is, with no warranty">
        <p>
          Lore is provided as is, with no warranty of any kind, express or implied, including any implied
          warranty of merchantability, fitness for a particular purpose, or non-infringement. It can lose
          your data, write something wrong, or stop working. Sections 15 and 16 of the AGPL-3.0 say the same
          thing about the code, and they say it in the version that holds up in court.
        </p>
        <p>
          To the fullest extent the law allows, we are not liable for lost profit, lost data, lost
          followers, or any indirect or consequential loss from using Lore, and total liability for
          anything to do with the hosted service is capped at what you paid for it in the past twelve
          months, which for now is nothing. Some places do not allow limits like this, in which case the
          smallest limit the law allows is the one that applies to you.
        </p>
      </Section>

      <Section heading="Ending it">
        <p>
          You can stop using the hosted service at any time and ask for your account to be deleted. We can
          close an account that breaks the rules above. The licence on the code is not affected either way.
        </p>
      </Section>

      <Section heading="Changes and contact">
        <p>
          When this page changes, the date at the top changes with it, and anything significant goes out on{' '}
          <Link href={X_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2">@vedsayys</Link>{' '}
          too. Carrying on using the service after a change means you accept it. Questions go to the same
          place.
        </p>
      </Section>
    </LegalPage>
  );
}
