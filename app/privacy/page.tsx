import Link from "next/link";
import { Shield, Lock, Trash2, ArrowLeft, Mail } from "lucide-react";

export const metadata = {
  title: "Privacy Policy | InstaFlow",
  description: "Privacy Policy and Meta User Data Deletion Policy for InstaFlow.",
};

export default function PrivacyPage() {
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
                <Shield className="w-6 h-6" />
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
                Privacy Policy
              </h1>
            </div>
            <p className="text-sm text-neutral-400">
              Last updated: September 28, 2026 &bull; Effective immediately
            </p>
          </div>

          <div className="space-y-6 text-neutral-300 leading-relaxed text-sm sm:text-base">
            <section>
              <h2 className="text-xl font-semibold text-white mb-2">1. Overview</h2>
              <p>
                This Privacy Policy describes how <strong>InstaFlow</strong> (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) collects, uses, and safeguards information when you connect your Instagram Professional/Creator account to our service. We are committed to protecting your privacy and complying with all applicable Meta Platform Terms and Developer Policies.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-2">2. Information We Collect</h2>
              <p className="mb-3">
                When you authenticate with our application via the Instagram Graph API and Meta Login for Business, we may access and process:
              </p>
              <ul className="list-disc pl-6 space-y-1.5 text-neutral-300">
                <li><strong>Instagram Account Profile:</strong> Username, account ID, profile picture, follower counts, and account type (Business or Creator).</li>
                <li><strong>Public Posts & Media:</strong> Media IDs, captions, permalinks, timestamps, and comments on your published posts/reels.</li>
                <li><strong>Direct Messages & Comments:</strong> Inbound message/comment content, commenter IDs, and sender details necessary to execute your configured automated replies.</li>
                <li><strong>Authentication Credentials:</strong> Secure OAuth access tokens granted by you during authorization.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-2">3. How We Use Your Information</h2>
              <p className="mb-3">We use the data strictly to provide the core services requested by you:</p>
              <ul className="list-disc pl-6 space-y-1.5 text-neutral-300">
                <li>To trigger instant automated direct messages and comment replies based on your defined rules and keywords.</li>
                <li>To display live conversation inboxes, engagement insights, and automation analytics on your dashboard.</li>
                <li>To sync and publish scheduled content when explicitly scheduled by you.</li>
                <li>We <strong>do not sell, rent, or trade</strong> your personal or Instagram account data to any third parties or advertisers.</li>
              </ul>
            </section>

            <section className="bg-neutral-950/60 border border-neutral-800 rounded-xl p-6">
              <div className="flex items-center gap-2.5 mb-2 text-violet-400">
                <Lock className="w-5 h-5" />
                <h2 className="text-lg font-semibold text-white">4. Data Storage & Security</h2>
              </div>
              <p className="text-sm text-neutral-300">
                All OAuth tokens and metadata are transmitted via encrypted HTTPS and stored using industry-standard AES-256 encryption. We implement strict role-based access control and never store raw passwords.
              </p>
            </section>

            <section className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-6">
              <div className="flex items-center gap-2.5 mb-2 text-amber-400">
                <Trash2 className="w-5 h-5" />
                <h2 className="text-lg font-semibold text-white">5. Meta User Data Deletion Instructions</h2>
              </div>
              <p className="text-sm text-neutral-300 mb-3">
                In compliance with Meta Platform Developer Policies, you have full control over your data. If you wish to delete your data associated with InstaFlow:
              </p>
              <ol className="list-decimal pl-6 space-y-1 text-sm text-neutral-300">
                <li>Go to your Instagram App or web profile $\rightarrow$ <strong>Settings</strong> $\rightarrow$ <strong>Apps and Websites</strong> $\rightarrow$ <strong>Active</strong>.</li>
                <li>Find <strong>InstaFlow</strong> (or our app name) and click <strong>Remove</strong>. This immediately revokes all access tokens.</li>
                <li>To permanently purge all stored comments, logs, and account metadata from our database, email your request to <span className="text-amber-300 font-medium">thevelocityexports@gmail.com</span> with the subject <em>&quot;Data Deletion Request&quot;</em> and your Instagram username. Your data will be completely deleted within 48 hours.</li>
              </ol>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-2">6. Third-Party Services</h2>
              <p>
                Our platform interacts directly with Meta Platforms, Inc. via official Instagram Graph APIs. Your use of Instagram is also governed by Meta&apos;s Privacy Policy and Terms of Service.
              </p>
            </section>

            <section className="border-t border-neutral-800 pt-6">
              <div className="flex items-center gap-2 mb-2 text-white">
                <Mail className="w-5 h-5 text-violet-400" />
                <h2 className="text-lg font-semibold">7. Contact Information</h2>
              </div>
              <p className="text-sm text-neutral-400">
                If you have questions regarding this Privacy Policy or our security practices, please contact us at: <a href="mailto:thevelocityexports@gmail.com" className="text-violet-400 underline hover:text-violet-300">thevelocityexports@gmail.com</a>.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
