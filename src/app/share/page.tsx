import { ShareUploader } from "@/components/ShareUploader";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Share a file · Useful Tools" };

export default function SharePage() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <PageHeader
        title="Share a file"
        description="Upload anything and hand over a link. Set an expiry, a password or a download cap before you start."
      />
      <ShareUploader />
    </main>
  );
}
