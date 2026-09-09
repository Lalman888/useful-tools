import { UploadHistory } from "@/components/UploadHistory";
import { Alert, PageHeader } from "@/components/ui";
import { storageAvailable } from "@/lib/storage";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My uploads",
  description: "The share links you have created from this browser.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function UploadsPage() {
  const available = storageAvailable();

  return (
    <main id="main" className="mx-auto max-w-4xl px-5 py-10">
      <PageHeader
        title="My uploads"
        description="Links you have created from this browser, with what the server still holds for each one."
      />
      {available ? (
        <UploadHistory />
      ) : (
        <Alert tone="warn">
          File sharing is switched off on this deployment, so there is nothing to manage
          here.
        </Alert>
      )}
    </main>
  );
}
