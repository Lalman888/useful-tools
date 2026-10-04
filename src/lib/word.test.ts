import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeMarkdownLinks } from "./word.ts";

test("ordinary links are left alone", () => {
  assert.equal(
    sanitizeMarkdownLinks("See [the docs](https://example.com/a?b=1#c)."),
    "See [the docs](https://example.com/a?b=1#c)."
  );
  assert.equal(sanitizeMarkdownLinks("[mail](mailto:a@b.com)"), "[mail](mailto:a@b.com)");
  assert.equal(sanitizeMarkdownLinks("[call](tel:+441234)"), "[call](tel:+441234)");
});

test("relative paths and anchors have no scheme and are kept", () => {
  assert.equal(sanitizeMarkdownLinks("[a](#heading)"), "[a](#heading)");
  assert.equal(sanitizeMarkdownLinks("[a](../other.html)"), "[a](../other.html)");
  assert.equal(sanitizeMarkdownLinks("[a](/root/path)"), "[a](/root/path)");
});

test("a script URL is emptied but the link text survives", () => {
  assert.equal(
    sanitizeMarkdownLinks("[HOSTILE](javascript:alert(1))"),
    "[HOSTILE]()"
  );
  assert.equal(sanitizeMarkdownLinks("[x](JaVaScRiPt:alert(1))"), "[x]()");
  assert.equal(sanitizeMarkdownLinks("[x](vbscript:msgbox)"), "[x]()");
  assert.equal(sanitizeMarkdownLinks("[x](file:///etc/passwd)"), "[x]()");
});

test("an embedded image survives, but a data URL that is not an image does not", () => {
  const png = "![logo](data:image/png;base64,iVBORw0KGgo=)";
  assert.equal(sanitizeMarkdownLinks(png), png);
  assert.equal(
    sanitizeMarkdownLinks("![x](data:text/html;base64,PHNjcmlwdD4=)"),
    "![x]()"
  );
});

test("several links in one document are each handled", () => {
  assert.equal(
    sanitizeMarkdownLinks("[a](https://ok.com) and [b](javascript:x) and [c](#d)"),
    "[a](https://ok.com) and [b]() and [c](#d)"
  );
});

test("text that merely looks like a link is untouched", () => {
  const plain = "Write javascript: in a sentence, or [brackets] alone.";
  assert.equal(sanitizeMarkdownLinks(plain), plain);
});

test("a destination containing balanced parentheses is still caught", () => {
  // The case a first-stop-at-`)` pattern misses entirely.
  assert.equal(
    sanitizeMarkdownLinks("[x](javascript:alert(document.domain))"),
    "[x]()"
  );
  assert.equal(sanitizeMarkdownLinks("[x](javascript:f(g(1)))"), "[x]()");
  // And a legitimate URL with parentheses in it survives.
  const wiki = "[a](https://en.wikipedia.org/wiki/Foo_(bar))";
  assert.equal(sanitizeMarkdownLinks(wiki), wiki);
});

test("a link title alongside the destination is preserved", () => {
  const titled = '[a](https://example.com "Hover text")';
  assert.equal(sanitizeMarkdownLinks(titled), titled);
});

test("unbalanced brackets are left as written", () => {
  assert.equal(sanitizeMarkdownLinks("[a](unclosed"), "[a](unclosed");
  assert.equal(sanitizeMarkdownLinks("](stray)"), "](stray)");
});
