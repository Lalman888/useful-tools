"use client";

import { useCallback, useRef, useState } from "react";
import { readWordFile, WordError, type WordDocument } from "@/lib/word";
import { triggerDownload } from "@/lib/xlsxExport";
import { safeFilename, suggestFilename } from "@/lib/filename";
import { Alert, Button, Field, Spinner, TextInput, cx } from "./ui";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

export function WordViewer() {
  const [doc, setDoc] = useState<WordDocument | null>(null);
  const [name, setName] = useState("");
  const [size, setSize] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saveAs, setSaveAs] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const open = useCallback(async (file: File) => {
    setLoading(true);
    setError("");
    try {
      const parsed = await readWordFile(file);
      setDoc(parsed);
      setName(file.name);
      setSize(file.size);
      // A name typed for the last document should not carry over to this one.
      setSaveAs("");
    } catch (caught) {
      setDoc(null);
      setError(
        caught instanceof WordError
          ? caught.message
          : "Could not read this document."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const copyText = async () => {
    if (!doc) return;
    try {
      await navigator.clipboard.writeText(doc.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked */
    }
  };

  const suggested = suggestFilename(name || "document", ".pdf");

  const downloadMarkdown = () => {
    if (!doc) return;
    triggerDownload(
      new Blob([doc.markdown], { type: "text/markdown;charset=utf-8" }),
      safeFilename(saveAs || suggestFilename(name || "document", ".md"), ".md")
    );
  };

  // Reuses the Markdown-to-PDF pipeline rather than printing the page, so the
  // result is typeset the same as everything else this app produces.
  const downloadPdf = async () => {
    if (!doc) return;
    setExporting(true);
    setError("");
    try {
      const response = await fetch("/api/markdown/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          markdown: doc.markdown,
          theme: "classic",
          // The .docx already opens with its own title; a generated cover page
          // on top of it would duplicate it.
          title: "",
          pageNumbers: true,
        }),
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(detail.error ?? "Could not produce a PDF.");
      }
      triggerDownload(await response.blob(), safeFilename(saveAs || suggested, ".pdf"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not produce a PDF.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* ------------------------------- opener ------------------------------ */}
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) void open(file);
        }}
        className={cx(
          "rounded-xl border-2 border-dashed px-6 py-8 text-center transition",
          dragging ? "border-slate-900 bg-slate-100" : "border-slate-300 bg-white"
        )}
      >
        <p className="text-sm font-medium text-slate-900">
          Drop a Word document here, or choose one
        </p>
        <p className="mt-1.5 text-xs text-slate-500">
          .docx and .dotx. Read in your browser — the file is never uploaded.
        </p>
        <Button variant="primary" className="mt-4" onClick={() => inputRef.current?.click()}>
          Choose a document
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".docx,.dotx,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void open(file);
            event.target.value = "";
          }}
        />
      </div>

      {loading && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner /> Reading the document
        </p>
      )}

      {error && <Alert>{error}</Alert>}

      {doc && (
        <>
          {/* ------------------------------ toolbar ----------------------------- */}
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">{name}</p>
              <p className="mt-0.5 text-xs text-slate-500 tnum">
                {formatBytes(size)} · {doc.words.toLocaleString()} words ·{" "}
                {doc.characters.toLocaleString()} characters
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <div className="w-44">
                <Field label="Save as">
                  <TextInput
                    value={saveAs}
                    onChange={(event) => setSaveAs(event.target.value)}
                    placeholder={suggested}
                    spellCheck={false}
                  />
                </Field>
              </div>
              <Button size="sm" onClick={copyText}>
                {copied ? "Copied" : "Copy text"}
              </Button>
              <Button size="sm" onClick={downloadMarkdown}>
                Markdown
              </Button>
              <Button size="sm" variant="primary" onClick={downloadPdf} disabled={exporting}>
                {exporting ? <Spinner /> : null} PDF
              </Button>
            </div>
          </div>

          {doc.notes.length > 0 && (
            <Alert tone="warn">
              <p className="font-medium">
                Some of this document could not be shown exactly as Word would.
              </p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs">
                {doc.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </Alert>
          )}

          {/* ----------------------------- document ---------------------------- */}
          <article
            className="docx-view rounded-xl border border-slate-200 bg-white px-8 py-10 sm:px-12"
            // Sanitised in readWordFile against a small allow-list: no scripts,
            // styles, embedded objects or javascript: URLs survive it.
            dangerouslySetInnerHTML={{ __html: doc.html }}
          />
        </>
      )}

      {!doc && !loading && !error && (
        <Alert tone="info">
          Nothing open yet. Word&rsquo;s own layout — page breaks, exact margins,
          headers and footers — is not reproduced here; the text, headings,
          lists, tables and images are.
        </Alert>
      )}
    </div>
  );
}
