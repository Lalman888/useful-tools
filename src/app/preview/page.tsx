import { MarkdownPreview } from "@/components/MarkdownPreview";
import { PageHeader } from "@/components/ui";

import type { Metadata } from "next";
import { toolByHref } from "@/lib/site";

const tool = toolByHref("/preview")!;

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

export default function PreviewPage() {
  return (
    <main id="main" className="mx-auto max-w-[1500px] px-5 py-8">
      <PageHeader
        title="Markdown preview"
        description="Paste Markdown and read it rendered — just the document, with no cover page and no contents list."
      />
      <MarkdownPreview />
    </main>
  );
}
