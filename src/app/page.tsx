import Link from "next/link";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL, TOOLS } from "@/lib/site";

/**
 * Describes the site to search engines in the vocabulary they read. Rendered
 * as a script tag, but it is data rather than code, built from the same list
 * the page itself renders.
 */
function structuredData() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        inLanguage: "en",
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_URL}/#app`,
        name: SITE_NAME,
        applicationCategory: "UtilitiesApplication",
        operatingSystem: "Any, via a web browser",
        url: SITE_URL,
        description: SITE_DESCRIPTION,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        featureList: TOOLS.filter((tool) => tool.indexable).map((tool) => tool.name),
      },
    ],
  };
}

export default function Home() {
  return (
    <main id="main" className="mx-auto max-w-6xl px-5 py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData()) }}
      />

      <div className="max-w-2xl">
        <h1 className="text-4xl font-semibold tracking-tight text-balance text-slate-900">
          A small set of tools for files you actually work with.
        </h1>
        <p className="mt-4 text-base leading-relaxed text-slate-600">
          Read spreadsheets without opening Excel, read Markdown without a build step,
          turn a draft into a document you would be happy to send, and hand someone a
          file without a size limit.
        </p>
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {TOOLS.map((tool) => (
          <Link
            key={tool.href}
            href={tool.href}
            className="group flex flex-col rounded-xl border border-slate-200 bg-white p-6 transition hover:border-slate-400 hover:shadow-sm"
          >
            <h2 className="text-base font-semibold text-slate-900">{tool.name}</h2>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-600">
              {tool.description}
            </p>
            <span className="mt-4 text-xs font-medium tracking-wide text-slate-400 uppercase">
              {tool.detail}
            </span>
          </Link>
        ))}
      </div>

      <p className="mt-10 max-w-2xl text-xs leading-relaxed text-slate-500">
        The viewer, the Markdown tools and the PDF toolkit run in your browser or discard
        their input immediately. Stored files live on this server&rsquo;s own disk, so
        capacity is bounded by the volume it runs on rather than by a per-file cap. For
        genuinely unbounded transfers, use{" "}
        <Link href="/p2p" className="underline underline-offset-2 hover:text-slate-700">
          direct transfer
        </Link>
        , which streams between browsers and stores nothing.
      </p>
    </main>
  );
}
