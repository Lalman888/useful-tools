"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { THEMES, type ThemeId } from "@/lib/themes";
import { Alert, Button, Checkbox, Field, Spinner, TextInput, cx, inputClass } from "./ui";

const SAMPLE = `# Quarterly Platform Review

A short opening paragraph that sets out what this document covers and who it
is for.

## Where we stand

Revenue grew across every region, with APAC leading on percentage growth.

| Region   |    Q1 |    Q2 | Change |
| -------- | ----: | ----: | -----: |
| EMEA     | 1,240 | 1,530 |   +23% |
| APAC     |   890 | 1,102 |   +24% |
| Americas | 2,310 | 2,290 |    -1% |

### How margin is calculated

Gross margin is $m = (r - c) / r$, summed over the period as:

$$\\sum_{i=1}^{n} (r_i - c_i)$$

## Engineering

\`\`\`python
def reconcile(ledger, statement):
    """Match ledger rows against a bank statement."""
    return [row for row in ledger if row.id not in statement]
\`\`\`

> Reliability reached 99.95% uptime this quarter.

- [x] Migrate the primary datastore
- [ ] Decommission the legacy workers

\\pagebreak

## Appendix

Figures are drawn from the finance warehouse.[^1]

[^1]: Unaudited, as of the last day of the quarter.
`;

type Options = {
  theme: ThemeId;
  accent: string;
  paper: string;
  baseFontSize: number;
  margin: number;
  numberHeadings: boolean;
  justify: boolean;
  includeCover: boolean;
  includeToc: boolean;
  tocDepth: number;
  dropFirstHeading: boolean;
  pageNumbers: boolean;
  title: string;
  subtitle: string;
  author: string;
  dateLabel: string;
  headerText: string;
  footerText: string;
};

const DEFAULTS: Options = {
  theme: "report",
  accent: "#1f4e79",
  paper: "A4",
  baseFontSize: 11,
  margin: 20,
  numberHeadings: false,
  justify: false,
  includeCover: true,
  includeToc: true,
  tocDepth: 3,
  dropFirstHeading: true,
  pageNumbers: true,
  title: "",
  subtitle: "",
  author: "",
  dateLabel: "",
  headerText: "",
  footerText: "",
};

const STORAGE_KEY = "useful-tools:markdown-studio";

export function MarkdownStudio() {
  const [markdown, setMarkdown] = useState(SAMPLE);
  const [options, setOptions] = useState<Options>(DEFAULTS);
  const [preview, setPreview] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  const set = useCallback(<K extends keyof Options>(key: K, value: Options[K]) => {
    setOptions((current) => ({ ...current, [key]: value }));
  }, []);

  // Restore the last session so a long draft survives a refresh.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { markdown?: string; options?: Partial<Options> };
        if (typeof parsed.markdown === "string") setMarkdown(parsed.markdown);
        if (parsed.options) setOptions((current) => ({ ...current, ...parsed.options }));
      }
    } catch {
      /* a corrupt or blocked store just means we start fresh */
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ markdown, options }));
      } catch {
        /* private mode, quota, or storage disabled */
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [markdown, options, restored]);

  const payload = useMemo(() => ({ ...options, markdown }), [options, markdown]);

  // The preview is a server render of the same stylesheet the PDF uses, so it
  // is debounced rather than run on every keystroke.
  useEffect(() => {
    if (!markdown.trim()) {
      setPreview("");
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setPreviewing(true);
      fetch("/api/markdown/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) {
            const detail = await response.json().catch(() => ({}));
            throw new Error(detail.error ?? "Preview failed.");
          }
          return response.text();
        })
        .then((html) => {
          setPreview(html);
          setError(null);
        })
        .catch((err: Error) => {
          if (err.name !== "AbortError") setError(err.message);
        })
        .finally(() => setPreviewing(false));
    }, 450);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [payload, markdown]);

  const exportPdf = async () => {
    setExporting(true);
    setError(null);
    try {
      const response = await fetch("/api/markdown/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.error ?? "Could not produce a PDF.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${(options.title || "document").replace(/[^\w\s.-]/g, "").trim() || "document"}.pdf`;
      anchor.click();
      // Revoke on the next tick so the download has started.
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not produce a PDF.");
    } finally {
      setExporting(false);
    }
  };

  const openMarkdownFile = (file: File) => {
    void file.text().then((text) => setMarkdown(text));
  };

  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_280px]">
      {/* ------------------------------- editor ------------------------------ */}
      <section className="flex min-h-[32rem] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white lg:h-[calc(100vh-12rem)]">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
          <h2 className="text-xs font-semibold tracking-wide text-slate-700 uppercase">
            Markdown
          </h2>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()}>
              Open .md
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMarkdown(SAMPLE)}>
              Reset
            </Button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".md,.markdown,.txt"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) openMarkdownFile(file);
              event.target.value = "";
            }}
          />
        </div>
        <textarea
          value={markdown}
          onChange={(event) => setMarkdown(event.target.value)}
          spellCheck={false}
          className="flex-1 resize-none p-4 font-mono text-[13px] leading-relaxed text-slate-800 focus:outline-none"
          placeholder="Write or paste Markdown here…"
        />
        <p className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500 tnum">
          {markdown.length.toLocaleString()} characters
        </p>
      </section>

      {/* ------------------------------ preview ------------------------------ */}
      <section className="flex min-h-[32rem] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white lg:h-[calc(100vh-12rem)]">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
          <h2 className="text-xs font-semibold tracking-wide text-slate-700 uppercase">
            Preview
          </h2>
          {previewing && <Spinner className="text-slate-400" />}
        </div>
        {preview ? (
          <iframe
            title="Document preview"
            srcDoc={preview}
            // The preview is our own server-rendered HTML, but it is built from
            // user input, so it runs in a sandbox with no script execution.
            sandbox=""
            className="flex-1 border-0 bg-slate-200"
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
            Nothing to preview yet.
          </div>
        )}
      </section>

      {/* ------------------------------ controls ----------------------------- */}
      <aside className="flex flex-col gap-5 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 lg:h-[calc(100vh-12rem)]">
        {error && <Alert>{error}</Alert>}

        <Button variant="primary" onClick={exportPdf} disabled={exporting || !markdown.trim()}>
          {exporting ? <Spinner /> : null}
          {exporting ? "Building PDF…" : "Download PDF"}
        </Button>

        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-700 uppercase">
            Theme
          </h3>
          <div className="space-y-1.5">
            {THEMES.map((theme) => (
              <button
                key={theme.id}
                type="button"
                onClick={() => {
                  set("theme", theme.id);
                  set("accent", theme.accent);
                }}
                className={cx(
                  "w-full rounded-lg border p-2.5 text-left transition",
                  options.theme === theme.id
                    ? "border-slate-900 bg-slate-50"
                    : "border-slate-200 hover:border-slate-400"
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ background: theme.accent }}
                    aria-hidden="true"
                  />
                  {theme.name}
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-slate-500">
                  {theme.description}
                </span>
              </button>
            ))}
          </div>
        </div>

        <Field label="Accent colour">
          <div className="flex gap-2">
            <input
              type="color"
              value={options.accent}
              onChange={(event) => set("accent", event.target.value)}
              className="h-9 w-12 cursor-pointer rounded border border-slate-300 bg-white p-1"
            />
            <TextInput
              value={options.accent}
              onChange={(event) => set("accent", event.target.value)}
            />
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Paper">
            <select
              value={options.paper}
              onChange={(event) => set("paper", event.target.value)}
              className={inputClass}
            >
              {["A4", "Letter", "Legal", "A3"].map((paper) => (
                <option key={paper}>{paper}</option>
              ))}
            </select>
          </Field>
          <Field label="Margin (mm)">
            <TextInput
              type="number"
              min={8}
              max={40}
              value={options.margin}
              onChange={(event) => set("margin", Number(event.target.value))}
            />
          </Field>
        </div>

        <Field label={`Body size — ${options.baseFontSize}pt`}>
          <input
            type="range"
            min={8}
            max={16}
            step={0.5}
            value={options.baseFontSize}
            onChange={(event) => set("baseFontSize", Number(event.target.value))}
            className="w-full accent-slate-900"
          />
        </Field>

        <div className="space-y-0.5 border-t border-slate-200 pt-3">
          <Checkbox
            label="Cover page"
            checked={options.includeCover}
            onChange={(value) => set("includeCover", value)}
          />
          {options.includeCover && (
            <Checkbox
              label="Drop the opening heading"
              hint="It already appears on the cover."
              checked={options.dropFirstHeading}
              onChange={(value) => set("dropFirstHeading", value)}
            />
          )}
          <Checkbox
            label="Table of contents"
            checked={options.includeToc}
            onChange={(value) => set("includeToc", value)}
          />
          <Checkbox
            label="Number the headings"
            checked={options.numberHeadings}
            onChange={(value) => set("numberHeadings", value)}
          />
          <Checkbox
            label="Justify body text"
            checked={options.justify}
            onChange={(value) => set("justify", value)}
          />
          <Checkbox
            label="Page numbers"
            checked={options.pageNumbers}
            onChange={(value) => set("pageNumbers", value)}
          />
        </div>

        <div className="space-y-3 border-t border-slate-200 pt-3">
          <Field label="Title" hint="Defaults to the first heading.">
            <TextInput
              value={options.title}
              onChange={(event) => set("title", event.target.value)}
              placeholder="Quarterly Platform Review"
            />
          </Field>
          <Field label="Subtitle">
            <TextInput
              value={options.subtitle}
              onChange={(event) => set("subtitle", event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Author">
              <TextInput
                value={options.author}
                onChange={(event) => set("author", event.target.value)}
              />
            </Field>
            <Field label="Date">
              <TextInput
                value={options.dateLabel}
                onChange={(event) => set("dateLabel", event.target.value)}
                placeholder="Q2 2026"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Header">
              <TextInput
                value={options.headerText}
                onChange={(event) => set("headerText", event.target.value)}
                placeholder="Confidential"
              />
            </Field>
            <Field label="Footer">
              <TextInput
                value={options.footerText}
                onChange={(event) => set("footerText", event.target.value)}
              />
            </Field>
          </div>
        </div>
      </aside>
    </div>
  );
}
