/**
 * Canonical site details, used for metadata, Open Graph, the sitemap and the
 * web manifest.
 */

export const SITE_NAME = "Useful Tools";

export const SITE_TAGLINE = "File tools that stay out of your way";

export const SITE_DESCRIPTION =
  "Read CSV and Excel files as a real table, preview Markdown, turn it into a typeset PDF, " +
  "merge and split PDFs, and share any file with no size limit — most of it without the file " +
  "ever leaving your browser.";

/**
 * Resolves the public origin. An explicit value always wins; otherwise the
 * host platform is asked, because the same build runs on more than one.
 * Metadata needs an absolute URL, so a localhost fallback keeps development
 * working rather than emitting relative Open Graph URLs, which crawlers reject.
 */
function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  // Render sets this to the service's external URL, including the scheme.
  if (process.env.RENDER_EXTERNAL_URL) {
    return process.env.RENDER_EXTERNAL_URL.replace(/\/+$/, "");
  }
  // Vercel sets the host without a scheme.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;

  return `http://localhost:${process.env.PORT ?? 3000}`;
}

/**
 * Best guess at build time, used for `metadataBase` so canonical and Open
 * Graph URLs are absolute. Set NEXT_PUBLIC_SITE_URL when building if the
 * platform does not expose its own URL, or these fall back to localhost.
 */
export const SITE_URL = resolveSiteUrl();

/**
 * The origin this particular request arrived on.
 *
 * robots.txt and the sitemap are fetched by crawlers against a real hostname,
 * and are the two places a baked-in localhost would actually do damage, so
 * they read the host from the request rather than trusting the build.
 */
export async function requestSiteUrl(): Promise<string> {
  const { headers } = await import("next/headers");
  try {
    const list = await headers();
    const host = list.get("x-forwarded-host") ?? list.get("host");
    if (host) {
      const proto =
        list.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
      return `${proto}://${host}`;
    }
  } catch {
    /* called outside a request; fall through to the configured value */
  }
  return SITE_URL;
}

export type ToolPage = {
  href: string;
  name: string;
  /** Shown on the home page and used as the page's meta description. */
  description: string;
  /** A short label for the card footer. */
  detail: string;
  /** Whether search engines should index it. */
  indexable: boolean;
};

/**
 * One list, used for the navigation, the home page, the sitemap and each
 * page's metadata, so the three cannot drift apart.
 */
export const TOOLS: ToolPage[] = [
  {
    href: "/viewer",
    name: "Data viewer",
    description:
      "Open a CSV, TSV or Excel workbook and read it as a real table: filter any column, sort by several at once, see column statistics, and export what you are looking at. CSV never leaves your browser.",
    detail: ".csv · .tsv · .xlsx · .xlsm",
    indexable: true,
  },
  {
    href: "/preview",
    name: "Markdown preview",
    description:
      "Paste Markdown and read it rendered, with proper typography, tables, code, maths and diagrams. No cover page, no contents list — just the document.",
    detail: "Paste and read",
    indexable: true,
  },
  {
    href: "/markdown",
    name: "Markdown to PDF",
    description:
      "Turn Markdown into a typeset document: four professional themes, a cover page, a contents list with real page numbers, headers, footers, letterheads and Mermaid diagrams.",
    detail: "Tables · code · maths · diagrams",
    indexable: true,
  },
  {
    href: "/pdf",
    name: "PDF toolkit",
    description:
      "Merge PDFs, pull out a page range, rotate pages, or stamp a watermark across them. Runs entirely in the browser, so nothing is uploaded.",
    detail: "Nothing uploaded",
    indexable: true,
  },
  {
    href: "/share",
    name: "Share a file",
    description:
      "Upload anything and get a link. Uploads are chunked and resumable with no size limit in the app, and you can add an expiry, a password or a download cap.",
    detail: "Any file type · resumable",
    indexable: true,
  },
  {
    href: "/uploads",
    name: "My uploads",
    description:
      "The share links you have created from this browser, with what the server still holds for each one.",
    detail: "Copy · revoke",
    // Personal to one browser; there is nothing here for a crawler.
    indexable: false,
  },
  {
    href: "/p2p",
    name: "Direct transfer",
    description:
      "Send a file straight from one browser to another over an encrypted peer connection. Nothing is stored on the server, so nothing constrains the size.",
    detail: "Peer to peer · nothing stored",
    indexable: true,
  },
];

export function toolByHref(href: string): ToolPage | undefined {
  return TOOLS.find((tool) => tool.href === href);
}
