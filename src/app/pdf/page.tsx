import { PdfToolkit } from "@/components/PdfToolkit";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "PDF toolkit · Useful Tools" };

export default function PdfPage() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <PageHeader
        title="PDF toolkit"
        description="Merge, extract, rotate and watermark PDFs. Everything runs in your browser, so the files never leave your machine and there is no size limit."
      />
      <PdfToolkit />
    </main>
  );
}
