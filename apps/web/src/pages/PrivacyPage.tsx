import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BRAND_NAME } from "../components/Brand";

export const PRIVACY_CONTACT = "privacy@clashofcoders.online";
const UPDATED = "22 November 2026";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="m-0 font-display text-xl font-bold tracking-wider text-ink uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

const external = "text-you underline-offset-4 hover:underline";

/** What we collect, why, who processes it, and how to get it removed. */
export function PrivacyPage() {
  return (
    <main className="flex flex-1 justify-center px-4 py-8 md:px-[5%] md:py-12">
      <article className="flex w-full max-w-3xl flex-col gap-8 leading-relaxed text-soft">
        <header className="flex flex-col gap-2">
          <p className="m-0 font-mono text-xs tracking-[0.2em] text-you uppercase">Legal</p>
          <h1 className="m-0 font-display text-4xl font-bold tracking-wide text-ink uppercase italic md:text-5xl">
            Privacy Policy
          </h1>
          <p className="m-0 text-sm text-muted">Last updated {UPDATED}</p>
          <p className="m-0">
            {BRAND_NAME} (“we”, “us”) runs clashofcoders.online, a site for live 1v1 coding battles.
            This page explains what information we collect, why, and the choices you have.
          </p>
        </header>

        <Section title="What we collect">
          <ul className="m-0 flex list-disc flex-col gap-2 pl-5 marker:text-you">
            <li>
              <b className="text-ink">Account details:</b> your email address, username, chosen
              avatar and password. Passwords are stored only as secure hashes by our login provider;
              we never see them.
            </li>
            <li>
              <b className="text-ink">Game data:</b> the code you submit in battles, test results,
              ratings, win/loss records, battle history, friends, challenges and custom rooms.
            </li>
            <li>
              <b className="text-ink">Technical data:</b> basic request logs (such as IP address,
              browser and time) kept by our hosting providers for security and to fix problems.
            </li>
          </ul>
          <p className="m-0">
            We do not sell your personal information, and we never ask for payment details.
          </p>
        </Section>

        <Section title="How we use it">
          <ul className="m-0 flex list-disc flex-col gap-2 pl-5 marker:text-you">
            <li>To create your account and confirm your email with a one-time code.</li>
            <li>To match you with opponents, run and judge your code, and keep ratings.</li>
            <li>To show public rankings and profiles (username, avatar, rating and record).</li>
            <li>To keep the service secure, prevent abuse and fix bugs.</li>
            <li>To show advertising that helps keep the site free (see below).</li>
          </ul>
        </Section>

        <Section title="What other players can see">
          <p className="m-0">
            Your username, avatar, rating, record and battle results are public. After a battle
            ends, your opponent can read the solution you submitted in it. Your email address is
            never shown to other players.
          </p>
        </Section>

        <Section title="Services we use">
          <ul className="m-0 flex list-disc flex-col gap-2 pl-5 marker:text-you">
            <li>
              <b className="text-ink">Supabase</b>: database, login and live updates.
            </li>
            <li>
              <b className="text-ink">Cloudflare</b>: hosting and security.
            </li>
            <li>
              <b className="text-ink">Resend</b>: sending sign-up and password reset codes.
            </li>
            <li>
              <b className="text-ink">Judge0 (via RapidAPI)</b>: running submitted code against
              tests. Only the code and test input are sent, never your account details.
            </li>
            <li>
              <b className="text-ink">Google Fonts</b>: the site's typefaces.
            </li>
            <li>
              <b className="text-ink">Google AdSense</b>: advertising.
            </li>
          </ul>
          <p className="m-0">
            These providers process data on our behalf, may store it in other countries, and are
            bound by their own privacy terms.
          </p>
        </Section>

        <Section title="Advertising and cookies">
          <p className="m-0">
            We use Google AdSense to show ads. Third-party vendors, including Google, use cookies to
            serve ads based on your prior visits to this and other websites. Google's use of
            advertising cookies enables it and its partners to serve ads to you based on your visits
            to this site and/or other sites on the internet.
          </p>
          <p className="m-0">
            You can opt out of personalised advertising in{" "}
            <a
              className={external}
              href="https://adssettings.google.com"
              target="_blank"
              rel="noreferrer"
            >
              Google Ads Settings
            </a>
            , or opt out of some third-party vendors' cookies at{" "}
            <a
              className={external}
              href="https://www.aboutads.info/choices"
              target="_blank"
              rel="noreferrer"
            >
              aboutads.info
            </a>
            . Learn more in{" "}
            <a
              className={external}
              href="https://policies.google.com/technologies/partner-sites"
              target="_blank"
              rel="noreferrer"
            >
              how Google uses information from sites that use its services
            </a>
            . Visitors in the European Economic Area, the UK and Switzerland are asked for consent
            before personalised ads are shown.
          </p>
          <p className="m-0">
            The site itself also stores a few things in your browser: your login session, unsent
            code in a battle editor (so a refresh does not lose it), and small settings such as
            muting emotes. These are needed for the site to work and are not used for advertising.
          </p>
        </Section>

        <Section title="How long we keep it">
          <p className="m-0">
            We keep your account and game data while your account exists. When an account is
            deleted, its profile, submissions and history are removed. Provider logs are kept for a
            limited time under their own policies.
          </p>
        </Section>

        <Section title="Your choices and rights">
          <p className="m-0">
            You can change your avatar on your profile and reset your password from the log-in page.
            To get a copy of your data, correct it, or delete your account, email{" "}
            <a className={external} href={`mailto:${PRIVACY_CONTACT}`}>
              {PRIVACY_CONTACT}
            </a>{" "}
            from the address on your account. Depending on where you live, you may also have the
            right to object to or restrict some uses, and to complain to your data protection
            authority.
          </p>
        </Section>

        <Section title="Children">
          <p className="m-0">
            {BRAND_NAME} is not meant for children under 13, and we do not knowingly collect their
            information. If you believe a child has signed up, contact us and we will delete the
            account.
          </p>
        </Section>

        <Section title="Security">
          <p className="m-0">
            Connections are encrypted (HTTPS), passwords are hashed, and database access is limited
            by strict permissions. No service is perfectly secure, so please use a password you do
            not use elsewhere.
          </p>
        </Section>

        <Section title="Changes and contact">
          <p className="m-0">
            We may update this policy; the date at the top shows the latest version. Questions?
            Email{" "}
            <a className={external} href={`mailto:${PRIVACY_CONTACT}`}>
              {PRIVACY_CONTACT}
            </a>
            .
          </p>
        </Section>

        <p className="m-0">
          <Link to="/" className="text-you">
            Back to {BRAND_NAME}
          </Link>
        </p>
      </article>
    </main>
  );
}
