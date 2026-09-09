import type { MetadataRoute } from "next";
import { requestSiteUrl, TOOLS } from "@/lib/site";

// Resolved per request so the URLs match the host actually being crawled.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const base = await requestSiteUrl();

  return [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 1,
    },
    // Share links and the personal uploads list are deliberately absent: a
    // sitemap is a public invitation to crawl, and neither belongs in one.
    ...TOOLS.filter((tool) => tool.indexable).map((tool) => ({
      url: `${base}${tool.href}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
  ];
}
