import { SheetViewer } from "@/components/SheetViewer";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Data viewer · Useful Tools" };

export default function ViewerPage() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <PageHeader
        title="Data viewer"
        description="Open a CSV, TSV or Excel workbook and read it as a table. Sort by any column, search every cell, and switch between sheets."
      />
      <SheetViewer />
    </main>
  );
}
