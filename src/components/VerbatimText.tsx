"use client";

import { cx } from "./ui";

/**
 * Renders text exactly as given.
 *
 * Shared by the page you type on and the page someone watching the link sees,
 * so "the same text is shown to them" is true of the rendering as well as the
 * content. Nothing here parses or transforms: the text is a React text node
 * inside a <pre>, so every space, tab and blank line survives and no markup in
 * it is ever interpreted.
 */
export function VerbatimText({
  text,
  wrap = true,
  numbers = false,
  fontSize = 14,
}: {
  text: string;
  wrap?: boolean;
  numbers?: boolean;
  fontSize?: number;
}) {
  return (
    <div className="overflow-x-auto">
      <pre
        className={cx(
          "m-0 px-4 py-4 font-mono text-slate-900",
          // `break-all` rather than `break-words`: a long unbroken token — a
          // key, a URL — must wrap rather than force the page sideways, and it
          // has no spaces to break on.
          wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"
        )}
        style={{ fontSize: `${fontSize}px`, lineHeight: 1.6 }}
      >
        {numbers ? (
          <code>
            {text.split("\n").map((line, index) => (
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
          // One text node, so the browser has nothing of ours to reflow and the
          // content is provably unaltered.
          <code>{text}</code>
        )}
      </pre>
    </div>
  );
}
