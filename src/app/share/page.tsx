import { ShareUploader } from "@/components/ShareUploader";
import { Alert, PageHeader } from "@/components/ui";
import { storageAvailable } from "@/lib/storage";

import type { Metadata } from "next";
import { toolByHref } from "@/lib/site";

const tool = toolByHref("/share")!;

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

// Storage is a property of the running host, not of the build, so this page
// must be rendered per request rather than prerendered.
export const dynamic = "force-dynamic";

export default function SharePage() {
  const available = storageAvailable();

  return (
    <main id="main" className="mx-auto max-w-6xl px-5 py-10">
      <PageHeader
        title="Share a file"
        description="Upload anything and hand over a link. Set an expiry, a password or a download cap before you start."
      />
      {available ? (
        <ShareUploader />
      ) : (
        <div className="max-w-2xl">
          <Alert tone="warn">
            <p className="font-medium">File sharing is switched off on this deployment.</p>
            <p className="mt-1.5">
              Storing a shared file needs a writable disk that survives between requests,
              which serverless hosting does not provide. Run this app on a host with a
              persistent volume to turn it on. The data viewer and Markdown to PDF work
              here as normal, and direct transfer needs no storage at all.
            </p>
          </Alert>
        </div>
      )}
    </main>
  );
}
