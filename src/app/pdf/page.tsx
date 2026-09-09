import { PdfToolkit } from "@/components/PdfToolkit";
import { PageHeader } from "@/components/ui";

import type { Metadata } from "next";
import { toolByHref } from "@/lib/site";

const tool = toolByHref("/pdf")!;

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

export default function PdfPage() {
  return (
    <main id="main" className="mx-auto max-w-6xl px-5 py-10">
      <PageHeader
        title="PDF toolkit"
        description="Merge, extract, rotate and watermark PDFs. Everything runs in your browser, so the files never leave your machine and there is no size limit."
      />
      <PdfToolkit />
    </main>
  );
}
