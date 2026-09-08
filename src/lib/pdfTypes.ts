import type { ThemeId } from "./themes";

/**
 * Render options and their defaults, kept free of any Node or browser
 * dependency so that validation, the API routes and the client can share them
 * without pulling in Chromium.
 */

export type PaperSize = "A4" | "Letter" | "Legal" | "A3";

export type MermaidTheme = "default" | "neutral" | "dark" | "forest";

export type PdfOptions = {
  markdown: string;
  theme: ThemeId;
  accent: string;
  baseFontSize: number;
  paper: PaperSize;
  margin: number; // millimetres
  numberHeadings: boolean;
  justify: boolean;
  includeCover: boolean;
  includeToc: boolean;
  /** Deepest heading level listed in the contents (1-4). */
  tocDepth: number;
  mermaidTheme: MermaidTheme;
  /** A data: URI for the letterhead mark, validated before it reaches here. */
  logo: string;
  /** Also repeat the mark in the running header. */
  logoInHeader: boolean;
  /** Width of the mark on the cover, in millimetres. */
  logoWidth: number;
  /** Remove the document's opening H1 from the body when it is already on the cover. */
  dropFirstHeading: boolean;
  title: string;
  subtitle: string;
  author: string;
  dateLabel: string;
  headerText: string;
  footerText: string;
  pageNumbers: boolean;
};

export const DEFAULT_PDF_OPTIONS: Omit<PdfOptions, "markdown"> = {
  theme: "report",
  accent: "#1f4e79",
  baseFontSize: 11,
  paper: "A4",
  margin: 20,
  numberHeadings: false,
  justify: false,
  includeCover: false,
  includeToc: false,
  tocDepth: 3,
  mermaidTheme: "neutral",
  logo: "",
  logoInHeader: false,
  logoWidth: 40,
  dropFirstHeading: true,
  title: "",
  subtitle: "",
  author: "",
  dateLabel: "",
  headerText: "",
  footerText: "",
  pageNumbers: true,
};
