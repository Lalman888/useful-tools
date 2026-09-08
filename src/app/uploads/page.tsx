import { UploadHistory } from "@/components/UploadHistory";
import { Alert, PageHeader } from "@/components/ui";
import { storageAvailable } from "@/lib/storage";

export const metadata = { title: "My uploads · Useful Tools" };

export const dynamic = "force-dynamic";

export default function UploadsPage() {
  const available = storageAvailable();

  return (
    <main className="mx-auto max-w-4xl px-5 py-10">
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
