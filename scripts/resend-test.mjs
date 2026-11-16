/**
 * Sends one test email through Resend to check the API key works.
 *
 *   node scripts/resend-test.mjs <to> [from]
 *
 * The key is read from RESEND_API_KEY in apps/worker/.dev.vars (git-ignored) or
 * the environment and is never printed. Until a domain is verified in Resend,
 * `from` must be onboarding@resend.dev and `to` must be the Resend account's
 * own email address.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readKey() {
  if (process.env.RESEND_API_KEY) return process.env.RESEND_API_KEY;
  const text = readFileSync(join(import.meta.dirname, "../apps/worker/.dev.vars"), "utf8");
  const line = text.split(/\r?\n/).find((l) => l.startsWith("RESEND_API_KEY="));
  const key = line?.slice("RESEND_API_KEY=".length).trim();
  if (!key) throw new Error("RESEND_API_KEY is not set in apps/worker/.dev.vars");
  return key;
}

const [to, from = "Code Wars <onboarding@resend.dev>"] = process.argv.slice(2);
if (!to) {
  console.error("Usage: node scripts/resend-test.mjs <to> [from]");
  process.exit(1);
}

const response = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { Authorization: `Bearer ${readKey()}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    from,
    to: [to],
    subject: "Code Wars: Resend test",
    html: `<div style="font-family:Arial,sans-serif;background:#05060a;color:#f2f5ff;padding:24px">
<h1 style="margin:0 0 12px;font-style:italic">CODE <span style="color:#22e6ff">WARS</span></h1>
<p>This is a test email sent through Resend.</p>
<p>If you can read this, the API key works and Code Wars can send email.</p>
</div>`,
    text: "Code Wars: this is a test email sent through Resend. If you can read this, the API key works.",
  }),
});
const body = await response.json().catch(() => ({}));
if (response.ok) {
  console.log(`Sent. Resend email id: ${body.id}`);
} else {
  console.log(`Not sent (HTTP ${response.status}): ${body.message ?? JSON.stringify(body)}`);
  process.exit(1);
}
