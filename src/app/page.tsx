import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-16">
      <main className="mx-auto flex max-w-3xl flex-col gap-6">
        <div>
          <h1 className="text-3xl font-semibold text-zinc-900">
            Dynamic Chat Widget
          </h1>
          <p className="mt-2 text-base text-zinc-600">
            Copy-paste live chat widget with a Supabase-backed agent dashboard.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/login"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
          >
            Agent login
          </Link>
          <Link
            href="/dashboard"
            className="rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700"
          >
            Go to inbox
          </Link>
          <Link
            href="/widget?tenant=00000000-0000-0000-0000-000000000001"
            className="rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700"
          >
            Widget preview
          </Link>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600">
          <p>
            Embed snippet:
            <code className="mt-2 block rounded bg-zinc-100 p-3 text-xs text-zinc-700">
              {`<script src="https://your-app.com/widget.js" data-tenant="YOUR_TENANT_ID" data-host="https://your-app.com"></script>`}
            </code>
          </p>
        </div>
      </main>
    </div>
  );
}
