"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { THEMES, type ThemeId } from "@/lib/themes";
import { Alert, Button, Spinner, cx } from "./ui";

const STORAGE_KEY = "useful-tools:markdown-preview";

type Layout = "reading" | "page";

/**
 * A plain reader: paste Markdown, see it rendered. Deliberately no cover page
 * and no contents list — those belong to the export studio, and getting them
 * by default is exactly what makes a quick preview annoying.
 */
export function MarkdownPreview() {
  const [markdown, setMarkdown] = useState("");
  const [html, setHtml] = useState("");
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeId>("modern");
  const [layout, setLayout] = useState<Layout>("reading");
  const [fontSize, setFontSize] = useState(12);
  const [splitView, setSplitView] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [restored, setRestored] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          markdown?: string;
          theme?: ThemeId;
          layout?: Layout;
          fontSize?: number;
        };
        if (typeof parsed.markdown === "string") setMarkdown(parsed.markdown);
        if (parsed.theme) setTheme(parsed.theme);
        if (parsed.layout) setLayout(parsed.layout);
        if (typeof parsed.fontSize === "number") setFontSize(parsed.fontSize);
      }
    } catch {
      /* blocked or corrupt storage just means we start empty */
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ markdown, theme, layout, fontSize })
        );
      } catch {
        /* nothing useful to do */
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [markdown, theme, layout, fontSize, restored]);

  const request = useMemo(
    () => ({
      markdown,
      theme,
      baseFontSize: fontSize,
      // The whole point of this page: no front page, no index.
      includeCover: false,
      includeToc: false,
      pageNumbers: false,
      layout,
    }),
    [markdown, theme, fontSize, layout]
  );

  useEffect(() => {
    if (!markdown.trim()) {
      setHtml("");
      setError(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setRendering(true);
      fetch("/api/markdown/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) {
            const detail = await response.json().catch(() => ({}));
            throw new Error(detail.error ?? "Could not render that Markdown.");
          }
          return response.text();
        })
        .then((text) => {
          setHtml(text);
          setError(null);
        })
        .catch((err: Error) => {
          if (err.name !== "AbortError") setError(err.message);
        })
        .finally(() => setRendering(false));
    }, 350);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [request, markdown]);

  const openFile = useCallback((file: File) => {
    void file.text().then(setMarkdown);
  }, []);

  const downloadPdf = async () => {
    setExporting(true);
    setError(null);
    try {
      const response = await fetch("/api/markdown/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, pageNumbers: true }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.error ?? "Could not produce a PDF.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "document.pdf";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not produce a PDF.");
    } finally {
      setExporting(false);
    }
  };

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked */
    }
  };

  const empty = !markdown.trim();

  return (
    <div className="space-y-4">
      {/* ------------------------------ toolbar ----------------------------- */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5">
        <div className="flex rounded-lg bg-slate-100 p-0.5">
          {(["reading", "page"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setLayout(value)}
              className={cx(
                "rounded-md px-2.5 py-1 text-xs font-medium transition",
                layout === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
              )}
            >
              {value === "reading" ? "Reading" : "Paper"}
            </button>
          ))}
        </div>

        <select
          value={theme}
          onChange={(event) => setTheme(event.target.value as ThemeId)}
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:border-slate-900 focus:outline-none"
          aria-label="Typography"
        >
          {THEMES.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Smaller text"
            onClick={() => setFontSize((size) => Math.max(9, size - 1))}
          >
            A−
          </Button>
          <span className="text-xs text-slate-500 tnum">{fontSize}pt</span>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Larger text"
            onClick={() => setFontSize((size) => Math.min(18, size + 1))}
          >
            A+
          </Button>
        </div>

        <Button
          size="sm"
          onClick={() => setSplitView((current) => !current)}
          className={cx(!splitView && "ring-2 ring-slate-900")}
        >
          {splitView ? "Hide editor" : "Show editor"}
        </Button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {rendering && <Spinner className="text-slate-400" />}
          <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()}>
            Open .md
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".md,.markdown,.txt"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) openFile(file);
              event.target.value = "";
            }}
          />
          <Button size="sm" onClick={copyMarkdown} disabled={empty}>
            {copied ? "Copied" : "Copy source"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMarkdown("")} disabled={empty}>
            Clear
          </Button>
          <Button size="sm" variant="primary" onClick={downloadPdf} disabled={empty || exporting}>
            {exporting ? <Spinner /> : null} PDF
          </Button>
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      {/* ------------------------------- panes ------------------------------ */}
      <div
        className={cx(
          "grid gap-4",
          splitView ? "lg:grid-cols-2" : "grid-cols-1"
        )}
      >
        {splitView && (
          <section className="flex h-[calc(100vh-15rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
              <h2 className="text-xs font-semibold tracking-wide text-slate-700 uppercase">
                Paste Markdown
              </h2>
              <span className="text-xs text-slate-400 tnum">
                {markdown.length.toLocaleString()}
              </span>
            </div>
            <textarea
              value={markdown}
              onChange={(event) => setMarkdown(event.target.value)}
              spellCheck={false}
              autoFocus
              placeholder="Paste or type Markdown here — it renders on the right as you go."
              className="flex-1 resize-none p-4 font-mono text-[13px] leading-relaxed text-slate-800 focus:outline-none"
            />
          </section>
        )}

        <section
          className={cx(
            "flex h-[calc(100vh-15rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white",
            !splitView && "mx-auto w-full"
          )}
        >
          {html ? (
            <iframe
              title="Rendered Markdown"
              srcDoc={html}
              // Server-rendered from user input, so it runs sandboxed with no
              // script execution.
              sandbox=""
              className="h-full w-full border-0"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <p className="text-sm font-medium text-slate-900">Nothing to show yet</p>
              <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-slate-500">
                Paste Markdown on the left and it appears here — just the document, with
                no cover page and no contents list.
              </p>
              <p className="mt-4 max-w-sm text-xs leading-relaxed text-slate-400">
                Need a cover, a contents list, headers and page numbers?{" "}
                <Link
                  href="/markdown"
                  className="underline underline-offset-2 hover:text-slate-600"
                >
                  Use the export studio
                </Link>
                .
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
