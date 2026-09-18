import type { Metadata } from 'next';
import Link from 'next/link';
import { Bullets, Code, LegalPage, Section } from '@/components/marketing/legal';
import { GITHUB_URL, X_URL } from '@/components/marketing/social';

export const metadata: Metadata = {
  title: 'Privacy | Lore',
  description: 'What Lore stores, what it sends to model providers and to the shared relay, and how to delete it.',
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      updated="18 September 2026"
      summary="This is a plain summary of what happens to your data, written so you can check it against the code. It is not legal advice."
    >
      <Section heading="Two ways to run Lore">
        <p>
          The hosted service at trylore.xyz is run by Vedaang Singh, and your account and your content
          live in a Postgres database he runs. If you install Lore yourself from the{' '}
          <Link href={GITHUB_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2">source</Link>,
          the same tables are created on a database you control and he never sees any of it. The rest of
          this page says which is which.
        </p>
      </Section>

      <Section heading="What the hosted service stores">
        <p>All of it sits in one Postgres database, and you can read the schema in <Code>lib/db/schema.ts</Code>:</p>
        <Bullets
          items={[
            'Your account: email address, the name you typed, a scrypt hash of your password, and a session record while you are signed in. If you sign in with Google instead, the account row holds the tokens Google issued.',
            'Your brands: the handle you connect, the brief you write, the categories and the voice document Lore builds from your posts.',
            'Posts pulled from X for the handles you connect, with their public like, reply, retweet and view counts.',
            'Drafts, the edits you make to them, and the rules Lore writes from those edits.',
            'Interview sessions and the messages in them, chat history with Lore, ideas, notes and files you save to the vault, and any learning report it generates.',
            'If you link Telegram, the chat id of that conversation so the bot knows where to send briefs.',
            'Scheduled posts, and a log of background runs and credit usage.',
          ]}
        />
        <p>
          There is no analytics script, no advertising pixel and no third-party tracker on any page. The
          only cookie is the one that keeps you signed in.
        </p>
      </Section>

      <Section heading="What a self-hosted install stores instead">
        <p>
          The same tables, on your own Postgres, on whatever machine you point <Code>DATABASE_URL</Code> at. Nothing
          in that database is sent anywhere by Lore itself. The two exceptions are the ones below: the
          model provider you connect, and the shared relay if you use it.
        </p>
      </Section>

      <Section heading="What goes to a model provider">
        <p>
          Lore cannot write without a model, and the model is never local. Whatever you connect is where
          the prompts go: Anthropic if you use Claude or an Anthropic key, OpenAI if you use Codex or an
          OpenAI key, OpenRouter if you use an OpenRouter key, and OpenRouter passes the call on to
          whichever model you picked there.
        </p>
        <p>
          Those prompts carry your drafts, your own posts, your voice document and rules, your interview
          answers, and any article or thread you asked Lore to read. Once a prompt leaves, that provider
          handles it under their own terms and their own retention policy, which we have no control over.
          When you use the Claude Code or Codex CLI, Lore runs it with tools switched off and with{' '}
          <Code>DATABASE_URL</Code>, <Code>AUTH_SECRET</Code> and every API key stripped from the environment it gets.
        </p>
      </Section>

      <Section heading="What goes to the shared relay">
        <p>
          The relay exists so you can try X lookups and voice interviews before paying for keys. It only
          gets used when you have no key of your own for that feature, and setting <Code>LORE_RELAY=off</Code> turns
          it off completely. It receives four things: the X handles and search terms being looked up, the
          text being read aloud, the voice clips being transcribed, and your install&apos;s relay key. It
          never receives your drafts, your database or your model prompts.
        </p>
        <p>The relay keeps a small row per install: a SHA-256 hash of the key, how many credits are left,
          daily totals, and a salted hash of the IP address that registered it. Plain IP addresses are not
          stored. When you unlock the free credits it also stores your X user id and handle, and your
          GitHub user id and login if the GitHub step is on, so the same account cannot claim starter
          credits twice.</p>
      </Section>

      <Section heading="What Lore reads from X, and why">
        <p>
          When you connect a handle, Lore fetches that account&apos;s public profile and its public posts
          going back about six months, through twitterapi.io, with your key or through the relay. It reads
          them to work out how you write and to show you your own numbers, which is the whole point of the
          product. It uses no X login and holds no X token, so it cannot read anything a logged-out visitor
          could not read, and it cannot post. Every draft ends at a Post on X button that opens X with the
          text filled in, and you press send.
        </p>
      </Section>

      <Section heading="How long it is kept">
        <p>
          On the hosted service, rows stay until you delete them or delete your account. Deleting a draft,
          a note or a brand removes it from the database. A copy can survive in a database backup for a
          while after that, and relay key rows stay until the key is revoked.
        </p>
        <p>
          On a self-hosted install nothing expires on its own, because it is your database. Running{' '}
          <Code>docker compose down -v</Code> or dropping the database removes everything.
        </p>
      </Section>

      <Section heading="Deleting your account">
        <p>
          Hosted: message{' '}
          <Link href={X_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2">@vedsayys on X</Link>{' '}
          from the account you signed up with, or from an address you can prove is yours, and ask for the
          account to be deleted. It gets removed within 30 days at the latest, along with the brands, drafts,
          posts, interviews and notes attached to it. There is no self-serve delete button yet, which is
          worth knowing before you sign up.
        </p>
        <p>
          Self-hosted: drop the database, or delete the rows you want gone. To disconnect from the relay,
          delete the relay key row in <Code>instance_settings</Code>, or set <Code>LORE_RELAY=off</Code>.
        </p>
      </Section>

      <Section heading="Changes and contact">
        <p>
          If this page changes in a way that matters, the date at the top changes with it. Questions about
          any of it go to{' '}
          <Link href={X_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2">@vedsayys</Link>.
          Security problems go through the private advisory form on the repository, covered in{' '}
          <Code>SECURITY.md</Code>.
        </p>
      </Section>
    </LegalPage>
  );
}
