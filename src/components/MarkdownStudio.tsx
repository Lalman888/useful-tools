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

\`\`\`mermaid
graph LR
  A[Draft] --> B{Review}
  B -->|approved| C[Publish]
  B -->|changes| A
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
  mermaidTheme: string;
  logo: string;
  logoInHeader: boolean;
  logoWidth: number;
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
  mermaidTheme: "neutral",
  logo: "",
  logoInHeader: false,
  logoWidth: 40,
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

type Doc = { id: string; name: string; text: string };

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Files are joined with a hard page break, so each begins a fresh page. */
const CHAPTER_SEPARATOR = "\n\n\\pagebreak\n\n";

/**
 * Paper widths in CSS pixels at 96dpi. The preview renders at true paper width
 * so its line breaks match the PDF, then the whole frame is scaled down to fit
 * the pane rather than reflowing the text.
 */
const PAPER_WIDTH_PX: Record<string, number> = {
  A4: 794,
  Letter: 816,
  Legal: 816,
  A3: 1123,
};
/** Matches the horizontal padding the preview stylesheet puts around the sheet. */
const PREVIEW_GUTTER = 32;

export function MarkdownStudio() {
  const [documents, setDocuments] = useState<Doc[]>([
    { id: "first", name: "document.md", text: SAMPLE },
  ]);
  const [activeId, setActiveId] = useState("first");
  const [options, setOptions] = useState<Options>(DEFAULTS);
  const [preview, setPreview] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const previewBox = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  const set = useCallback(<K extends keyof Options>(key: K, value: Options[K]) => {
    setOptions((current) => ({ ...current, [key]: value }));
  }, []);

  // Restore the last session so a long draft survives a refresh.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          markdown?: string;
          documents?: Doc[];
          options?: Partial<Options>;
        };
        if (Array.isArray(parsed.documents) && parsed.documents.length > 0) {
          setDocuments(parsed.documents);
          setActiveId(parsed.documents[0].id);
        } else if (typeof parsed.markdown === "string") {
          // Sessions saved before multi-file support held a single string.
          setDocuments([{ id: "first", name: "document.md", text: parsed.markdown }]);
        }
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
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ documents, options }));
      } catch {
        /* private mode, quota, or storage disabled */
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [documents, options, restored]);

  // Keep the preview scaled to whatever width the pane currently has.
  useEffect(() => {
    const element = previewBox.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setBox({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);
    setBox({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, [preview]);

  const documentWidth = (PAPER_WIDTH_PX[options.paper] ?? 794) + PREVIEW_GUTTER;
  const scale = box.width > 0 ? Math.min(1, box.width / documentWidth) : 1;

  // Every file, in order, as one document.
  const markdown = useMemo(
    () => documents.map((doc) => doc.text).join(CHAPTER_SEPARATOR),
    [documents]
  );
  const active = documents.find((doc) => doc.id === activeId) ?? documents[0];

  const updateActive = useCallback(
    (text: string) => {
      setDocuments((current) =>
        current.map((doc) => (doc.id === active?.id ? { ...doc, text } : doc))
      );
    },
    [active?.id]
  );

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

  const openMarkdownFiles = async (list: FileList) => {
    const added: Doc[] = [];
    for (const file of Array.from(list)) {
      added.push({ id: newId(), name: file.name, text: await file.text() });
    }
    if (added.length === 0) return;
    // Replace a pristine starting document, otherwise append as more chapters.
    setDocuments((current) => {
      const untouched =
        current.length === 1 && current[0].id === "first" && current[0].text === SAMPLE;
      return untouched ? added : [...current, ...added];
    });
    setActiveId(added[0].id);
  };

  const moveDoc = (index: number, delta: number) => {
    setDocuments((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const fileInput = useRef<HTMLInputElement>(null);
  const logoInput = useRef<HTMLInputElement>(null);

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
              Add files
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDocuments([{ id: "first", name: "document.md", text: SAMPLE }]);
                setActiveId("first");
              }}
            >
              Reset
            </Button>
          </div>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".md,.markdown,.txt"
            className="hidden"
            onChange={(event) => {
              if (event.target.files?.length) void openMarkdownFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </div>

        {documents.length > 1 && (
          <div className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-2 py-1.5">
            {documents.map((doc, index) => (
              <div
                key={doc.id}
                className={cx(
                  "flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs",
                  doc.id === active?.id
                    ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-300"
                    : "text-slate-600 hover:bg-slate-200/60"
                )}
              >
                <button
                  type="button"
                  onClick={() => setActiveId(doc.id)}
                  className="max-w-40 truncate px-1 py-0.5 font-medium"
                  title={`Chapter ${index + 1}: ${doc.name}`}
                >
                  {index + 1}. {doc.name}
                </button>
                <button
                  type="button"
                  aria-label={`Move ${doc.name} earlier`}
                  disabled={index === 0}
                  onClick={() => moveDoc(index, -1)}
                  className="px-0.5 text-slate-400 hover:text-slate-800 disabled:opacity-30"
                >
                  ‹
                </button>
                <button
                  type="button"
                  aria-label={`Move ${doc.name} later`}
                  disabled={index === documents.length - 1}
                  onClick={() => moveDoc(index, 1)}
                  className="px-0.5 text-slate-400 hover:text-slate-800 disabled:opacity-30"
                >
                  ›
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${doc.name}`}
                  onClick={() => {
                    setDocuments((current) => {
                      const next = current.filter((entry) => entry.id !== doc.id);
                      return next.length > 0 ? next : current;
                    });
                    if (doc.id === active?.id) {
                      const fallback = documents.find((entry) => entry.id !== doc.id);
                      if (fallback) setActiveId(fallback.id);
                    }
                  }}
                  className="px-0.5 text-slate-400 hover:text-red-600"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          value={active?.text ?? ""}
          onChange={(event) => updateActive(event.target.value)}
          spellCheck={false}
          className="flex-1 resize-none p-4 font-mono text-[13px] leading-relaxed text-slate-800 focus:outline-none"
          placeholder="Write or paste Markdown here…"
        />
        <p className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500 tnum">
          {documents.length > 1
            ? `${documents.length} files · ${markdown.length.toLocaleString()} characters, each file starting a new page`
            : `${markdown.length.toLocaleString()} characters`}
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
        <div ref={previewBox} className="relative flex-1 overflow-hidden bg-slate-200">
          {preview ? (
            <iframe
              title="Document preview"
              srcDoc={preview}
              // Our own server-rendered HTML, but built from user input, so it
              // runs sandboxed with scripts disabled.
              sandbox=""
              style={{
                width: documentWidth,
                height: box.height > 0 ? box.height / scale : "100%",
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
              className="border-0"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              Nothing to preview yet.
            </div>
          )}
        </div>
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

        <Field label="Diagrams" hint="Applies to ```mermaid blocks.">
          <select
            value={options.mermaidTheme}
            onChange={(event) => set("mermaidTheme", event.target.value)}
            className={inputClass}
          >
            <option value="neutral">Neutral</option>
            <option value="default">Default</option>
            <option value="forest">Forest</option>
            <option value="dark">Dark</option>
          </select>
        </Field>

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
              hint={
                options.title.trim()
                  ? "Ignored while a title is set: the heading is a section, not the title."
                  : "It already appears on the cover."
              }
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
          <Field label="Letterhead" hint="Shown on the cover. PNG, JPEG or SVG.">
            {options.logo ? (
              <div className="flex items-center gap-3 rounded-lg border border-slate-200 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={options.logo} alt="" className="h-8 w-auto max-w-24 object-contain" />
                <Button size="sm" variant="ghost" onClick={() => set("logo", "")}>
                  Remove
                </Button>
              </div>
            ) : (
              <Button size="sm" className="w-full" onClick={() => logoInput.current?.click()}>
                Choose an image
              </Button>
            )}
            <input
              ref={logoInput}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                // Read as a data URI: the renderer refuses to fetch anything,
                // so the image has to travel inside the document.
                if (file.size > 1_400_000) {
                  setError("That image is too large; use one under about 1.4 MB.");
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => set("logo", String(reader.result ?? ""));
                reader.onerror = () => setError("Could not read that image.");
                reader.readAsDataURL(file);
              }}
            />
          </Field>

          {options.logo && (
            <>
              <Field label={`Cover size — ${options.logoWidth}mm`}>
                <input
                  type="range"
                  min={10}
                  max={90}
                  value={options.logoWidth}
                  onChange={(event) => set("logoWidth", Number(event.target.value))}
                  className="w-full accent-slate-900"
                />
              </Field>
              <Checkbox
                label="Repeat it in the header"
                checked={options.logoInHeader}
                onChange={(value) => set("logoInHeader", value)}
              />
            </>
          )}

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
