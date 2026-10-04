/**
 * Turning something a person typed into a file name a browser and a filesystem
 * will both accept.
 *
 * The caller owns the extension, because a name and its type are not the user's
 * to disagree about: asking for "report" and getting "report" with no extension,
 * or typing "report.pdf" and getting "report.pdf.pdf", are both wrong.
 */

/** Illegal on Windows, and `/` would read as a path everywhere. */
const ILLEGAL = /[<>:"/\\|?*]/g;

/** Control characters and DEL, which no file name should carry. */
const CONTROL = /[\u0000-\u001f\u007f]/g;

/**
 * Windows device names, which cannot be used as a file name even with an
 * extension: saving "nul.pdf" there fails or silently writes nothing.
 */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Leaves room for the extension inside the 255-byte limit filesystems impose. */
const MAX_STEM = 200;

export function safeFilename(
  typed: string,
  extension: string,
  fallback = "document"
): string {
  // An empty extension means "just clean the name". Note the guard below: a
  // name always "ends with" the empty string, which would slice it away.
  const ext = !extension ? "" : extension.startsWith(".") ? extension : `.${extension}`;

  let stem = (typed ?? "")
    // A pasted path should contribute its last segment, not a directory.
    .split(/[\\/]/)
    .pop()!
    // Replaced with a space, not deleted: a name pasted across two lines is
    // two words, and joining them into one would be a silent edit.
    .replace(CONTROL, " ")
    .replace(ILLEGAL, "")
    // Collapse runs of whitespace; a name with a newline in it reads as corrupt.
    .replace(/\s+/g, " ")
    .trim();

  // Typing the extension is the obvious thing to do, so accept it rather than
  // doubling it up.
  if (ext && stem.toLowerCase().endsWith(ext.toLowerCase())) {
    stem = stem.slice(0, -ext.length).trim();
  }

  // Windows discards trailing dots and spaces, which would turn "v1." into "v1"
  // after the fact and make the saved name differ from the one shown.
  stem = stem.replace(/[. ]+$/, "");

  if (stem.length > MAX_STEM) stem = stem.slice(0, MAX_STEM).trim();
  if (!stem || RESERVED.test(stem)) stem = fallback;

  return `${stem}${ext}`;
}

/**
 * The name to offer before the person has typed one, derived from whatever the
 * document already calls itself — a title, or the file it was opened from.
 */
export function suggestFilename(source: string, extension: string, fallback = "document"): string {
  return safeFilename(source.replace(/\.[a-z0-9]{1,8}$/i, ""), extension, fallback);
}
