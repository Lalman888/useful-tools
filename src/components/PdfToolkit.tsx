"use client";

import { useCallback, useRef, useState } from "react";
import {
  extractPages,
  mergePdfs,
  pageCountOf,
  rotatePages,
  watermarkPdf,
  PdfToolError,
  type SourceFile,
} from "@/lib/pdfTools";
import { triggerDownload } from "@/lib/xlsxExport";
import { Alert, Button, Field, Spinner, TextInput, cx, inputClass } from "./ui";

type Tool = "merge" | "extract" | "rotate" | "watermark";

const TOOLS: Array<{ id: Tool; name: string; blurb: string; multiple: boolean }> = [
  {
    id: "merge",
    name: "Merge",
    blurb: "Join several PDFs into one, in the order you arrange them.",
    multiple: true,
  },
  {
    id: "extract",
    name: "Extract pages",
    blurb: "Pull a page selection out into a new document.",
    multiple: false,
  },
  {
    id: "rotate",
    name: "Rotate",
    blurb: "Turn selected pages a quarter, half or three-quarter turn.",
    multiple: false,
  },
  {
    id: "watermark",
    name: "Watermark",
    blurb: "Stamp text diagonally across the pages you choose.",
    multiple: false,
  },
];

type Loaded = SourceFile & { key: string; pages: number; size: number };

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

export function PdfToolkit() {
  const [tool, setTool] = useState<Tool>("merge");
  const [files, setFiles] = useState<Loaded[]>([]);
  const [selection, setSelection] = useState("1-");
  const [turn, setTurn] = useState(90);
  const [watermarkText, setWatermarkText] = useState("DRAFT");
  const [fontSize, setFontSize] = useState(64);
  const [opacity, setOpacity] = useState(0.18);
  const [color, setColor] = useState("#1f4e79");
  const [angle, setAngle] = useState(45);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const config = TOOLS.find((entry) => entry.id === tool)!;

  const addFiles = useCallback(
    async (list: FileList | File[]) => {
      setError(null);
      setDone(null);
      const incoming = Array.from(list).filter((file) =>
        file.name.toLowerCase().endsWith(".pdf")
      );
      if (incoming.length === 0) {
        setError("Those are not PDF files.");
        return;
      }

      const loaded: Loaded[] = [];
      for (const file of incoming) {
        const bytes = await file.arrayBuffer();
        const source: SourceFile = { name: file.name, bytes };
        try {
          loaded.push({
            ...source,
            key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
            pages: await pageCountOf(source),
            size: file.size,
          });
        } catch (err) {
          setError(err instanceof Error ? err.message : `Could not read ${file.name}.`);
        }
      }
      setFiles((current) => (config.multiple ? [...current, ...loaded] : loaded.slice(0, 1)));
      // A selection typed against the previous document may not exist in this
      // one, which surfaces later as a baffling "page 3 does not exist".
      if (!config.multiple) setSelection("1-");
    },
    [config.multiple]
  );

  const move = (index: number, delta: number) => {
    setFiles((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const first = files[0];
      if (!first) throw new PdfToolError("Choose a PDF first.");
      const base = first.name.replace(/\.pdf$/i, "");

      if (tool === "merge") {
        const bytes = await mergePdfs(files);
        triggerDownload(new Blob([bytes as BlobPart], { type: "application/pdf" }), "merged.pdf");
        setDone(`Merged ${files.length} files into one PDF.`);
      } else if (tool === "extract") {
        const { bytes, count } = await extractPages(first, selection);
        triggerDownload(
          new Blob([bytes as BlobPart], { type: "application/pdf" }),
          `${base}-pages.pdf`
        );
        setDone(`Extracted ${count} page${count === 1 ? "" : "s"}.`);
      } else if (tool === "rotate") {
        const bytes = await rotatePages(first, selection, turn);
        triggerDownload(
          new Blob([bytes as BlobPart], { type: "application/pdf" }),
          `${base}-rotated.pdf`
        );
        setDone(`Rotated by ${turn}°.`);
      } else {
        const bytes = await watermarkPdf(first, selection, {
          text: watermarkText,
          size: fontSize,
          opacity,
          color,
          angle,
        });
        triggerDownload(
          new Blob([bytes as BlobPart], { type: "application/pdf" }),
          `${base}-watermarked.pdf`
        );
        setDone("Watermark applied.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const totalPages = files.reduce((sum, file) => sum + file.pages, 0);
  const ready = config.multiple ? files.length >= 2 : files.length === 1;

  return (
    <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)_290px]">
      {/* --------------------------- tool picker --------------------------- */}
      <nav className="space-y-1.5">
        {TOOLS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => {
              setTool(entry.id);
              setError(null);
              setDone(null);
              setSelection("1-");
              if (!entry.multiple) setFiles((current) => current.slice(0, 1));
            }}
            className={cx(
              "w-full rounded-lg border p-3 text-left transition",
              tool === entry.id
                ? "border-slate-900 bg-slate-50"
                : "border-slate-200 bg-white hover:border-slate-400"
            )}
          >
            <span className="text-sm font-medium text-slate-900">{entry.name}</span>
            <span className="mt-0.5 block text-xs leading-snug text-slate-500">
              {entry.blurb}
            </span>
          </button>
        ))}
      </nav>

      {/* ------------------------------ files ------------------------------ */}
      <section className="space-y-3">
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void addFiles(event.dataTransfer.files);
          }}
          className={cx(
            "rounded-xl border-2 border-dashed p-8 text-center transition",
            dragging ? "border-slate-900 bg-slate-100" : "border-slate-300 bg-white"
          )}
        >
          <p className="text-sm font-medium text-slate-900">
            {config.multiple ? "Drop PDFs here" : "Drop a PDF here"}
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            Everything happens in your browser — nothing is uploaded.
          </p>
          <Button variant="primary" className="mt-4" onClick={() => inputRef.current?.click()}>
            {config.multiple ? "Choose PDFs" : "Choose a PDF"}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple={config.multiple}
            className="hidden"
            onChange={(event) => {
              if (event.target.files?.length) void addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </div>

        {files.length > 0 && (
          <ul className="space-y-2">
            {files.map((file, index) => (
              <li
                key={file.key}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5"
              >
                {config.multiple && (
                  <span className="w-5 shrink-0 text-xs text-slate-400 tnum">{index + 1}</span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{file.name}</p>
                  <p className="text-xs text-slate-500 tnum">
                    {file.pages} page{file.pages === 1 ? "" : "s"} · {formatBytes(file.size)}
                  </p>
                </div>
                {config.multiple && files.length > 1 && (
                  <div className="flex gap-0.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Move up"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Move down"
                      disabled={index === files.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </Button>
                  </div>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => setFiles((current) => current.filter((f) => f.key !== file.key))}
                >
                  ✕
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ----------------------------- options ----------------------------- */}
      <aside className="h-fit space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-xs font-semibold tracking-wide text-slate-700 uppercase">
          {config.name}
        </h2>

        {error && <Alert>{error}</Alert>}
        {done && <Alert tone="info">{done}</Alert>}

        {tool === "merge" && (
          <p className="text-xs leading-relaxed text-slate-500">
            {files.length < 2
              ? "Add two or more PDFs. Use the arrows to set the order."
              : `${files.length} files · ${totalPages} pages in total.`}
          </p>
        )}

        {tool !== "merge" && (
          <Field
            label="Pages"
            hint={
              files[0]
                ? `1 to ${files[0].pages}. Use 1-3, 7 or 5- for everything from 5.`
                : "Choose a PDF first."
            }
          >
            <TextInput
              value={selection}
              onChange={(event) => setSelection(event.target.value)}
              placeholder="1-"
            />
          </Field>
        )}

        {tool === "rotate" && (
          <Field label="Turn">
            <select
              value={turn}
              onChange={(event) => setTurn(Number(event.target.value))}
              className={inputClass}
            >
              <option value={90}>90° clockwise</option>
              <option value={180}>180°</option>
              <option value={270}>90° anticlockwise</option>
            </select>
          </Field>
        )}

        {tool === "watermark" && (
          <>
            <Field label="Text">
              <TextInput
                value={watermarkText}
                onChange={(event) => setWatermarkText(event.target.value)}
                placeholder="DRAFT"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={`Size — ${fontSize}pt`}>
                <input
                  type="range"
                  min={12}
                  max={160}
                  value={fontSize}
                  onChange={(event) => setFontSize(Number(event.target.value))}
                  className="w-full accent-slate-900"
                />
              </Field>
              <Field label={`Angle — ${angle}°`}>
                <input
                  type="range"
                  min={0}
                  max={90}
                  value={angle}
                  onChange={(event) => setAngle(Number(event.target.value))}
                  className="w-full accent-slate-900"
                />
              </Field>
            </div>
            <Field label={`Opacity — ${Math.round(opacity * 100)}%`}>
              <input
                type="range"
                min={5}
                max={100}
                value={Math.round(opacity * 100)}
                onChange={(event) => setOpacity(Number(event.target.value) / 100)}
                className="w-full accent-slate-900"
              />
            </Field>
            <Field label="Colour">
              <div className="flex gap-2">
                <input
                  type="color"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border border-slate-300 bg-white p-1"
                />
                <TextInput value={color} onChange={(event) => setColor(event.target.value)} />
              </div>
            </Field>
          </>
        )}

        <Button variant="primary" className="w-full" disabled={!ready || busy} onClick={run}>
          {busy ? <Spinner /> : null}
          {busy ? "Working…" : config.name}
        </Button>
      </aside>
    </div>
  );
}
