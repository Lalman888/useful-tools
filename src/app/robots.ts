import type { MetadataRoute } from "next";
import { requestSiteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = await requestSiteUrl();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // A share link is meant for the person you gave it to. Keeping these out
      // of an index is a privacy measure, not an SEO one; the pages themselves
      // also carry a noindex directive, since robots.txt only asks politely.
      disallow: ["/f/", "/api/", "/uploads"],
    },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
