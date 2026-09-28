import Link from "next/link";
import { FileText, CheckCircle2, AlertTriangle, ArrowLeft, Mail } from "lucide-react";

export const metadata = {
  title: "Terms of Service | InstaFlow",
  description: "Terms of Service for InstaFlow Instagram Automation platform.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
        </div>

        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-8 sm:p-12 shadow-2xl space-y-8">
          <div className="border-b border-neutral-800 pb-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400">
                <FileText className="w-6 h-6" />
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
                Terms of Service
              </h1>
            </div>
            <p className="text-sm text-neutral-400">
              Last updated: September 28, 2026 &bull; Version 2.0
            </p>
          </div>

          <div className="space-y-6 text-neutral-300 leading-relaxed text-sm sm:text-base">
            <section>
              <h2 className="text-xl font-semibold text-white mb-2">1. Acceptance of Terms</h2>
              <p>
                By accessing or using <strong>InstaFlow</strong> (&quot;the Service&quot;), you agree to be bound by these Terms of Service. If you do not agree with any part of these terms, you must not use or connect your Instagram account to the service.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-2">2. Description of Service</h2>
              <p>
                InstaFlow provides workflow automation tools for Instagram Business and Creator accounts, including automated comment replies, instant direct message responses, conversation management, and social engagement analytics using official Meta Instagram Graph APIs.
              </p>
            </section>

            <section className="bg-neutral-950/60 border border-neutral-800 rounded-xl p-6">
              <div className="flex items-center gap-2.5 mb-2 text-violet-400">
                <CheckCircle2 className="w-5 h-5" />
                <h2 className="text-lg font-semibold text-white">3. User Responsibilities & Fair Use</h2>
              </div>
              <ul className="list-disc pl-6 space-y-1.5 text-sm text-neutral-300">
                <li>You agree not to use the Service for sending spam, unsolicited bulk messages, deceptive offers, harassment, or illegal content.</li>
                <li>You must comply at all times with Instagram&apos;s Community Guidelines and Meta&apos;s Platform Developer Terms.</li>
                <li>You are solely responsible for all automated messages, replies, and content sent through your connected account.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-2">4. Meta / Instagram Relationship</h2>
              <p>
                InstaFlow is an independent software tool built on official Meta Graph APIs. We are not endorsed, affiliated, or sponsored by Meta Platforms, Inc. or Instagram. You acknowledge that Meta may change API rate limits, features, or policies at their sole discretion.
              </p>
            </section>

            <section className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-6">
              <div className="flex items-center gap-2.5 mb-2 text-amber-400">
                <AlertTriangle className="w-5 h-5" />
                <h2 className="text-lg font-semibold text-white">5. Disclaimer & Limitation of Liability</h2>
              </div>
              <p className="text-sm text-neutral-300">
                The service is provided &quot;AS IS&quot; and &quot;AS AVAILABLE&quot; without warranties of any kind. Under no circumstances shall InstaFlow or its operators be liable for any indirect, incidental, or consequential damages resulting from downtime, Instagram rate limits, account restrictions, or missed automated replies.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-2">6. Termination</h2>
              <p>
                You may terminate your account and disconnect your Instagram profile at any time via your dashboard settings or by revoking permissions in Instagram settings. We reserve the right to suspend or terminate accounts that violate Instagram policies or generate abusive spam.
              </p>
            </section>

            <section className="border-t border-neutral-800 pt-6">
              <div className="flex items-center gap-2 mb-2 text-white">
                <Mail className="w-5 h-5 text-violet-400" />
                <h2 className="text-lg font-semibold">7. Contact Support</h2>
              </div>
              <p className="text-sm text-neutral-400">
                For questions regarding these Terms, please contact our support team at: <a href="mailto:thevelocityexports@gmail.com" className="text-violet-400 underline hover:text-violet-300">thevelocityexports@gmail.com</a>.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
