import { MarkdownStudio } from "@/components/MarkdownStudio";
import { PageHeader } from "@/components/ui";

import type { Metadata } from "next";
import { toolByHref } from "@/lib/site";

const tool = toolByHref("/markdown")!;

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

export default function MarkdownPage() {
  return (
    <main id="main" className="mx-auto max-w-[1500px] px-5 py-8">
      <PageHeader
        title="Markdown to PDF"
        description="Write on the left, watch the typeset page on the right, and download a PDF with a cover, contents, headers and page numbers."
      />
      <MarkdownStudio />
    </main>
  );
}
