import Link from "next/link";

const TOOLS = [
  {
    href: "/viewer",
    title: "Data viewer",
    blurb:
      "Open a CSV, TSV or Excel workbook and read it as a real table — sheet tabs, sorting, search and frozen headers. Large files stay responsive.",
    detail: ".csv · .tsv · .xlsx · .xlsm",
  },
  {
    href: "/markdown",
    title: "Markdown to PDF",
    blurb:
      "Turn Markdown into a typeset document: four professional themes, a cover page, a contents list with real page numbers, headers and footers.",
    detail: "Tables · code · maths · footnotes",
  },
  {
    href: "/share",
    title: "Share a file",
    blurb:
      "Upload anything and get a link. Uploads are chunked and resumable with no size limit in the app, and you can add an expiry, a password or a download cap.",
    detail: "Any file type · resumable",
  },
  {
    href: "/p2p",
    title: "Direct transfer",
    blurb:
      "Send a file straight from one browser to another over an encrypted peer connection. Nothing is stored on the server, so nothing constrains the size.",
    detail: "Peer to peer · nothing stored",
  },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-16">
      <div className="max-w-2xl">
        <h1 className="text-4xl font-semibold tracking-tight text-balance text-slate-900">
          A small set of tools for files you actually work with.
        </h1>
        <p className="mt-4 text-base leading-relaxed text-slate-600">
          Read spreadsheets without opening Excel, hand someone a file without a size
          limit, and turn a Markdown draft into a document you would be happy to send.
        </p>
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {TOOLS.map((tool) => (
          <Link
            key={tool.href}
            href={tool.href}
            className="group flex flex-col rounded-xl border border-slate-200 bg-white p-6 transition hover:border-slate-400 hover:shadow-sm"
          >
            <h2 className="text-base font-semibold text-slate-900">{tool.title}</h2>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-600">
              {tool.blurb}
            </p>
            <span className="mt-4 text-xs font-medium tracking-wide text-slate-400 uppercase">
              {tool.detail}
            </span>
          </Link>
        ))}
      </div>

      <p className="mt-10 max-w-2xl text-xs leading-relaxed text-slate-500">
        Stored files live on this server&rsquo;s own disk, so capacity is bounded by the
        volume it runs on rather than by a per-file cap. For genuinely unbounded
        transfers, use{" "}
        <Link href="/p2p" className="underline underline-offset-2 hover:text-slate-700">
          direct transfer
        </Link>
        , which streams between browsers and stores nothing.
      </p>
    </main>
  );
}
