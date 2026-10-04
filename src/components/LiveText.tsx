"use client";

import { useEffect, useMemo, useState } from "react";
import { triggerDownload } from "@/lib/xlsxExport";
import { safeFilename } from "@/lib/filename";
import { Alert, Button, Checkbox, Field, cx } from "./ui";

/**
 * Shows pasted text back exactly as it was pasted.
 *
 * Nothing here parses, formats or highlights the content: it goes into the page
 * as a React text node inside a <pre>, so every space, tab, blank line and
 * stray character survives and no markup in it is ever interpreted. The page's
 * own colours are the only thing that differs from the source.
 */

const SAMPLE = `# paste anything — it comes back byte for byte

DATABASE_URL=postgres://user:pass@localhost:5432/app
REDIS_URL=redis://localhost:6379
    INDENTED=preserved exactly
STRIPE_KEY=sk_live_51H8xQ2abcdefghijklmnop

  trailing spaces, tabs	and	blank lines all survive
`;

/** Lines shaped like `KEY=value`, `KEY: value` or `export KEY=value`. */
const ASSIGNMENT = /^(\s*(?:export\s+)?[A-Za-z_][\w.-]*\s*[:=]\s*)(.*)$/;

function maskAssignments(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const match = line.match(ASSIGNMENT);
      if (!match) return line;
      const [, key, value] = match;
      const trimmed = value.trim();
      if (!trimmed) return line;
      // Keep the length visible so the shape of the file is unchanged, and keep
      // any quotes, so a masked line still reads as the line it replaced.
      const quote = /^(['"]).*\1$/.test(trimmed) ? trimmed[0] : "";
      const inner = quote ? trimmed.slice(1, -1) : trimmed;
      return `${key}${quote}${"•".repeat(Math.min(inner.length, 32))}${quote}`;
    })
    .join("\n");
}

export function LiveText() {
  const [text, setText] = useState("");
  const [wrap, setWrap] = useState(true);
  const [numbers, setNumbers] = useState(false);
  const [mask, setMask] = useState(false);
  const [fontSize, setFontSize] = useState(14);
  const [editing, setEditing] = useState(true);
  const [copied, setCopied] = useState(false);
  const [saveAs, setSaveAs] = useState("");
  const [restored, setRestored] = useState(false);

  // Kept per-browser only. Reloading the page mid-conversation and losing what
  // you were showing somebody would be the worst moment for it to vanish.
  useEffect(() => {
    try {
      setText(localStorage.getItem("useful-tools:livetext") ?? "");
    } catch {
      /* storage disabled or private mode */
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem("useful-tools:livetext", text);
    } catch {
      /* nothing useful to do; the text is still on screen */
    }
  }, [text, restored]);

  const shown = useMemo(() => (mask ? maskAssignments(text) : text), [mask, text]);

  const lines = useMemo(() => shown.split("\n"), [shown]);
  const stats = useMemo(
    () => ({
      lines: text ? text.split("\n").length : 0,
      characters: text.length,
      // Not the same as the character count once anything non-ASCII is in there,
      // which is exactly when a length limit somewhere else starts biting.
      bytes: new TextEncoder().encode(text).length,
    }),
    [text]
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked; the text is on screen to copy by hand */
    }
  };

  const download = () => {
    triggerDownload(
      new Blob([shown], { type: "text/plain;charset=utf-8" }),
      safeFilename(saveAs, ".txt", "pasted-text")
    );
  };

  const empty = !text;

  return (
    <div className="space-y-4">
      {/* ------------------------------ toolbar ------------------------------ */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        <Button size="sm" onClick={() => setEditing((current) => !current)}>
          {editing ? "Hide the box" : "Edit text"}
        </Button>
        <Button size="sm" onClick={copy} disabled={empty}>
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button size="sm" onClick={download} disabled={empty}>
          Download
        </Button>
        <input
          value={saveAs}
          onChange={(event) => setSaveAs(event.target.value)}
          placeholder="pasted-text.txt"
          spellCheck={false}
          aria-label="File name for the download"
          className="w-40 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:ring-1 focus:ring-slate-900 focus:outline-none"
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setText("")}
          disabled={empty}
        >
          Clear
        </Button>
        {empty && (
          <Button size="sm" variant="ghost" onClick={() => setText(SAMPLE)}>
            Use a sample
          </Button>
        )}
        <span className="ml-auto text-xs text-slate-500 tnum">
          {stats.lines.toLocaleString()} lines · {stats.characters.toLocaleString()} chars ·{" "}
          {stats.bytes.toLocaleString()} bytes
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="space-y-4">
          {editing && (
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              spellCheck={false}
              placeholder="Paste anything here — an .env file, a config block, a log, a key."
              className="h-52 w-full resize-y rounded-xl border border-slate-300 bg-white p-3.5 font-mono text-[13px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:ring-1 focus:ring-slate-900 focus:outline-none"
            />
          )}

          {/* ------------------------------ output ----------------------------- */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
              <h2 className="text-xs font-semibold tracking-wide text-slate-700 uppercase">
                {mask ? "Shown with values hidden" : "Exactly as pasted"}
              </h2>
              {!wrap && (
                <span className="text-xs text-slate-400">scrolls sideways</span>
              )}
            </div>
            {empty ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500">
                Whatever you paste appears here, character for character.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <pre
                  className={cx(
                    "m-0 px-4 py-4 font-mono text-slate-900",
                    // `break-all` rather than `break-words`: a long unbroken
                    // token — a key, a URL — must wrap rather than force the
                    // page sideways, and it has no spaces to break on.
                    wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"
                  )}
                  style={{ fontSize: `${fontSize}px`, lineHeight: 1.6 }}
                >
                  {numbers ? (
                    <code>
                      {lines.map((line, index) => (
                        <span key={index} className="block">
                          <span
                            aria-hidden
                            className="mr-4 inline-block w-[3ch] shrink-0 text-right text-slate-400 select-none tnum"
                          >
                            {index + 1}
                          </span>
                          {line}
                          {"\n"}
                        </span>
                      ))}
                    </code>
                  ) : (
                    // One text node, so the browser has nothing of ours to
                    // reflow and the content is provably unaltered.
                    <code>{shown}</code>
                  )}
                </pre>
              </div>
            )}
          </div>
        </div>

        {/* ------------------------------ controls ----------------------------- */}
        <aside className="h-fit space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-xs font-semibold tracking-wide text-slate-700 uppercase">
            Display
          </h2>

          <Field label={`Text size — ${fontSize}px`}>
            <input
              type="range"
              min={11}
              max={28}
              value={fontSize}
              onChange={(event) => setFontSize(Number(event.target.value))}
              className="w-full accent-slate-900"
            />
          </Field>

          <Checkbox
            label="Wrap long lines"
            checked={wrap}
            onChange={setWrap}
            hint="Off shows them full length, scrolling sideways."
          />
          <Checkbox label="Line numbers" checked={numbers} onChange={setNumbers} />
          <Checkbox
            label="Hide values"
            checked={mask}
            onChange={setMask}
            hint="Masks the right-hand side of KEY=value lines, so you can show the shape of an .env without showing the secrets."
          />

          <p className="border-t border-slate-200 pt-3 text-xs leading-relaxed text-slate-500">
            Nothing is uploaded and nothing is sent anywhere. The text stays in
            this browser, and is kept here if you reload.
          </p>
        </aside>
      </div>

      {mask && (
        <Alert tone="warn">
          Hiding values changes what is shown, and what Copy and Download
          produce. Turn it off to get the text back exactly as you pasted it.
        </Alert>
      )}
    </div>
  );
}
