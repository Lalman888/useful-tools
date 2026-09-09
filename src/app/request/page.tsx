import { RequestBuilder } from "@/components/RequestBuilder";
import { Alert, PageHeader } from "@/components/ui";
import { storageAvailable } from "@/lib/storage";

import type { Metadata } from "next";
import { toolByHref } from "@/lib/site";

const tool = toolByHref("/request")!;

export const metadata: Metadata = {
  title: tool.name,
  description: tool.description,
  alternates: { canonical: tool.href },
  openGraph: {
    title: `${tool.name} · Useful Tools`,
    description: tool.description,
    url: tool.href,
  },
};

// Storage is a property of the running host, not of the build.
export const dynamic = "force-dynamic";

export default function RequestPage() {
  const available = storageAvailable();

  return (
    <main id="main" className="mx-auto max-w-6xl px-5 py-10">
      <PageHeader
        title="Request files"
        description="Send someone a link and they can upload to you — no account, no app, nothing to install on their side."
      />
      {available ? (
        <RequestBuilder />
      ) : (
        <div className="max-w-2xl">
          <Alert tone="warn">
            <p className="font-medium">File requests are switched off on this deployment.</p>
            <p className="mt-1.5">
              Receiving a file needs a writable disk that survives between requests, which
              serverless hosting does not provide. Run this app on a host with a persistent
              volume to turn it on.
            </p>
          </Alert>
        </div>
      )}
    </main>
  );
}
