import { SheetViewer } from "@/components/SheetViewer";
import { PageHeader } from "@/components/ui";

import type { Metadata } from "next";
import { toolByHref } from "@/lib/site";

const tool = toolByHref("/viewer")!;

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

export default function ViewerPage() {
  return (
    <main id="main" className="mx-auto max-w-6xl px-5 py-10">
      <PageHeader
        title="Data viewer"
        description="Open a CSV, TSV or Excel workbook and read it as a table. Sort by any column, search every cell, and switch between sheets."
      />
      <SheetViewer />
    </main>
  );
}
