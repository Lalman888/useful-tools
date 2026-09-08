import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Useful Tools",
  description:
    "View CSV and Excel files, share any file with no size limit, and turn Markdown into a professional PDF.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
