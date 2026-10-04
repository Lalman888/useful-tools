/**
 * Reading a .docx in the browser.
 *
 * A Word file is a zip of XML, so mammoth can open it client-side and nothing
 * needs uploading. What it produces is HTML built from a document somebody else
 * authored, which makes it untrusted input: it is sanitised before it is ever
 * put into the page.
 */
import mammoth from "mammoth";
import DOMPurify from "dompurify";

export class WordError extends Error {}

export type WordDocument = {
  /** Sanitised HTML, safe to inject. */
  html: string;
  /** The same content as Markdown, for handing to the PDF exporter. */
  markdown: string;
  /** Plain text, used for the counts and for copying. */
  text: string;
  /** What mammoth could not represent — footnotes, odd fields, and so on. */
  notes: string[];
  words: number;
  characters: number;
};

/**
 * Word's own heading styles do not always carry through, because a document can
 * name them anything. These map the common ones onto real headings so the
 * outline survives instead of arriving as a wall of bold paragraphs.
 */
const STYLE_MAP = [
  "p[style-name='Title'] => h1.doc-title:fresh",
  "p[style-name='Subtitle'] => p.doc-subtitle:fresh",
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Heading 4'] => h4:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
  // mammoth ignores underline by default, on the grounds that it is often
  // decorative. In a document someone is reading for content it is not.
  "u => u",
  "r[style-name='Strong'] => strong",
  "r[style-name='Code'] => code",
];

/**
 * A deliberately small allow-list. A .docx can carry hyperlinks and embedded
 * images, and nothing else here needs to survive for the document to read
 * correctly — so scripts, styles, objects and iframes have no way through even
 * if a future mammoth version started emitting them.
 */
const ALLOWED_TAGS = [
  "p", "br", "hr", "span", "div",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "b", "em", "i", "u", "s", "sub", "sup", "code", "pre",
  "ul", "ol", "li", "blockquote",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td",
  "a", "img",
];

const ALLOWED_ATTR = ["href", "src", "alt", "title", "class", "colspan", "rowspan"];

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Images inside a .docx arrive as data: URIs, so those have to be allowed —
    // but only for images, and `javascript:` stays blocked for links.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|#|\/|data:image\/(?:png|jpeg|gif|webp|bmp|svg\+xml);base64,)/i,
    FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form", "input"],
    FORBID_ATTR: ["style", "srcset", "onerror", "onload"],
  });
}

/**
 * A link target we are willing to carry into the Markdown. A bare path or
 * anchor has no scheme and is harmless; only an explicit scheme can be.
 */
const SAFE_SCHEME = /^(?:https?:|mailto:|tel:)/i;
const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.\-]*:/i;

function safeTarget(target: string): string {
  const trimmed = target.trim();
  if (!HAS_SCHEME.test(trimmed)) return target; // relative path or #anchor
  if (SAFE_SCHEME.test(trimmed) || SAFE_DATA_IMAGE.test(trimmed)) return target;
  return "";
}

/**
 * The HTML gets sanitised by DOMPurify, but the Markdown is a second
 * representation of the same untrusted document and was leaving with its link
 * targets intact — so a `javascript:` hyperlink in a .docx ended up in the
 * downloaded .md and in whatever opened it next. markdown-it refuses such a
 * target when it renders, but a file handed to another tool has no such luck.
 *
 * Scanned rather than matched with a regular expression: a link destination may
 * contain balanced parentheses — `javascript:alert(1)` does — and a pattern
 * that stops at the first `)` walks straight past the dangerous part.
 */
export function sanitizeMarkdownLinks(markdown: string): string {
  let out = "";
  let index = 0;

  for (;;) {
    const open = markdown.indexOf("](", index);
    if (open === -1) {
      out += markdown.slice(index);
      return out;
    }
    out += markdown.slice(index, open + 2);

    // Balance parentheses the way CommonMark does for an inline destination.
    let depth = 1;
    let cursor = open + 2;
    for (; cursor < markdown.length; cursor++) {
      const char = markdown[cursor];
      if (char === "\\") {
        cursor++; // escaped character, whatever it is
        continue;
      }
      if (char === "\n") break; // a destination does not span lines
      if (char === "(") depth++;
      else if (char === ")" && --depth === 0) break;
    }

    if (depth !== 0) {
      // Unbalanced, so this was never a link destination. Carry on past it
      // rather than rewriting text that only looks like one.
      index = open + 2;
      continue;
    }

    out += safeTarget(markdown.slice(open + 2, cursor)) + ")";
    index = cursor + 1;
  }
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export async function readWordFile(file: File): Promise<WordDocument> {
  // The old binary .doc format is a different thing entirely, and mammoth
  // reports it only as a confusing zip error, so say so plainly up front.
  if (/\.doc$/i.test(file.name)) {
    throw new WordError(
      "This is the older .doc format, which cannot be read here. Open it in Word " +
        "or an online converter and save it as .docx first."
    );
  }
  if (!/\.docx?$/i.test(file.name) && !/\.dotx$/i.test(file.name)) {
    throw new WordError("Choose a Word .docx file.");
  }

  const arrayBuffer = await file.arrayBuffer();

  let html: Awaited<ReturnType<typeof mammoth.convertToHtml>>;
  let markdown: Awaited<ReturnType<typeof mammoth.convertToMarkdown>>;
  let raw: Awaited<ReturnType<typeof mammoth.extractRawText>>;
  try {
    // Three passes over the same buffer rather than one: mammoth has no single
    // call that yields all three, and re-reading a buffer already in memory is
    // cheaper than making the user press a second button to get Markdown.
    [html, markdown, raw] = await Promise.all([
      mammoth.convertToHtml({ arrayBuffer }, { styleMap: STYLE_MAP }),
      mammoth.convertToMarkdown({ arrayBuffer }, { styleMap: STYLE_MAP }),
      mammoth.extractRawText({ arrayBuffer }),
    ]);
  } catch (error) {
    throw new WordError(
      error instanceof Error && /zip|end of central directory/i.test(error.message)
        ? "This file is not a readable .docx. It may be corrupt, or renamed from another format."
        : "Could not read this document."
    );
  }

  const text = raw.value;
  return {
    html: sanitize(html.value),
    markdown: sanitizeMarkdownLinks(markdown.value),
    text,
    // Duplicates are common — one message per unmapped style, repeated per
    // paragraph — and a list of fifty identical lines tells you nothing.
    notes: [...new Set(html.messages.map((message) => message.message))].slice(0, 12),
    words: countWords(text),
    characters: text.length,
  };
}
