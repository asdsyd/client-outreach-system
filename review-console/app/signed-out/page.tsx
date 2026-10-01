import { chatGPTSignInPath } from "@/app/chatgpt-auth";

export const dynamic = "force-dynamic";

export default function SignedOut() {
  return (
    <main className="app-shell state-shell">
      <section className="state-card">
        <span className="brand-mark">N</span>
        <p className="eyebrow">Nunoon Outreach</p>
        <h1>Signed out</h1>
        <p>Your review session has ended.</p>
        <div className="state-actions">
          <a className="secondary-link" href={chatGPTSignInPath("/")}>
            Sign in with ChatGPT
          </a>
        </div>
      </section>
    </main>
  );
}
