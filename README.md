# Useful Tools

A handful of file tools in one small Next.js app:

| Tool | Path | What it does |
| --- | --- | --- |
| Data viewer | `/viewer` | Reads CSV, TSV and Excel workbooks as a sortable, searchable table |
| Markdown preview | `/preview` | Paste Markdown and read it rendered, with no cover page or contents list |
| Markdown to PDF | `/markdown` | Typesets Markdown into a PDF with a cover, contents, headers and page numbers |
| PDF toolkit | `/pdf` | Merge, extract, rotate and watermark PDFs, entirely in the browser |
| Share a file | `/share` | Chunked resumable upload of any file, with a share link |
| Request files | `/request` | A link that lets somebody else upload *to you*, with limits you set |
| My uploads | `/uploads` | The links you have created, with copy and revoke |
| Direct transfer | `/p2p` | Browser-to-browser transfer over WebRTC; nothing is stored |

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

For production:

```bash
npm run build
npm start
```

Both scripts run `server.mjs`, a small Node server that wraps Next and adds the
WebSocket endpoint the peer-to-peer tool uses for signalling. `next dev` and
`next start` on their own will serve every page, but direct transfers will not
connect.

### Requirements

- Node.js 20 or newer.
- A Chromium or Chrome binary, used to render PDFs. Common locations are found
  automatically; otherwise set `CHROME_PATH`.
- `node_modules` must be present at runtime: the PDF renderer reads the KaTeX
  and highlight.js stylesheets, and KaTeX's fonts, from disk.

## Deploying

The tools do not all need the same things from a host, so what you get depends
on where you run it.

| | Serverless (Vercel, Netlify, Lambda) | A server with a disk (Docker, Fly, Railway, a VPS) |
| --- | --- | --- |
| Data viewer | Works | Works |
| Markdown preview | Works | Works |
| Markdown to PDF | Works | Works |
| PDF toolkit | Works | Works |
| Share a file | **Off** | Works |
| Request files | **Off** | Works |
| Direct transfer | **Off** | Works |

The two that switch off do so because of what serverless hosting is, not
because of a missing setting:

- **Sharing and file requests** need a writable disk whose contents survive
  between requests.
  A serverless function gets a read-only application directory and a `/tmp`
  that is discarded, and the next request may land on a different instance
  entirely, so a share link would break the moment it was handed over. The app
  detects this at startup, the upload endpoints answer `503`, and the page says
  so instead of failing mid-upload.
- **Direct transfer** needs a WebSocket held open by a long-running process to
  introduce the two browsers. Functions cannot hold one. `server.mjs` sets
  `HAS_SIGNALING`, and the page reports the feature as unavailable when it is
  absent.

Both tools come back on their own the moment you run the app with its own
server on a host that has a persistent volume — no configuration needed.

### On Render specifically

Render's native Node runtime has no browser on its image, so PDF export fails
there with *"No Chromium executable found"*. The app is not serverless on
Render — `isServerless()` is false, because Render sets none of the variables
that identify a function environment — so it looks for a real Chromium and
finds nothing. There are two ways out.

**Use the Docker runtime.** This is the one to prefer. The `Dockerfile` in this
repository installs Chromium and the document fonts, and sets `CHROME_PATH`, so
nothing has to be configured in the dashboard. Set the service's Language to
**Docker** (or import `render.yaml` as a Blueprint) and redeploy. The same
image runs anywhere else that takes a container.

**Or stay on the Node runtime and download Chrome at build time.** Change the
build command to:

```bash
npm install && npx @puppeteer/browsers install chrome-headless-shell@stable --path ./.cache/puppeteer && npm run build
```

and set `PUPPETEER_CACHE_DIR` to `/opt/render/project/src/.cache/puppeteer`.
The path matters: only the repository checkout survives from the build into the
running service, so a download into the default `~/.cache` is gone by the time
a request arrives. The app searches that cache and picks the newest build it
finds, so no version number has to be written down anywhere. The headless shell
is used rather than full Chrome because it is smaller and needs fewer shared
libraries — which is also the weakness of this route, since the Node image
supplies those libraries rather than the app, and a future image could stop.

**Attach a disk either way.** Render gives a service a fresh filesystem on
every deploy and restart, so without one, shared files and everything sent to a
request link are deleted each time you push. Add a disk, mount it at
`/var/data`, and set `DATA_DIR=/var/data`. Set `SHARE_SECRET` too, or a restart
invalidates every unlock cookie already issued.

### On Vercel specifically

It deploys as-is with no `vercel.json`. Vercel ignores `server.mjs` and serves
the Next build itself, so the viewer and the PDF exporter work and the other
two report themselves off.

PDF rendering uses `@sparticuz/chromium` there, because the function image has
no browser. That image also ships only Open Sans, which would print serif
themes in sans and code in a proportional face, so the Liberation faces in
`assets/fonts` are copied into fontconfig's search path before Chromium starts
and `outputFileTracingIncludes` keeps them in the deployed bundle. Note also
that Vercel caps a request body at 4.5 MB, so `CHUNK_SIZE` would have to drop
below that if you ever put sharing behind a blob store.

## Configuration

Every setting is optional. See `.env.example`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATA_DIR` | `./data` | Where uploaded files and their metadata live |
| `MAX_FILE_SIZE` | `0` | Per-file ceiling in bytes; `0` means no limit |
| `CHUNK_SIZE` | `8388608` | Upload chunk size in bytes |
| `DEFAULT_EXPIRY_HOURS` | `0` | Default link lifetime; `0` means links never expire |
| `MAX_REQUEST_FILES` | `25` | Ceiling on how many files one request link will accept |
| `DEFAULT_REQUEST_EXPIRY_HOURS` | `336` | Default lifetime of a request link; `0` means never |
| `MAX_PREVIEW_ROWS` | `50000` | Row cap for a spreadsheet preview |
| `MAX_PARSE_BYTES` | `209715200` | Largest file the viewer will parse |
| `SHARE_SECRET` | generated | Key for signing password-unlock cookies, for both share and request links |
| `CHROME_PATH` | auto-detected | Chromium executable used for PDF rendering |
| `PUPPETEER_CACHE_DIR` | `~/.cache/puppeteer` | Where to look for a Chrome installed by `@puppeteer/browsers` |
| `NEXT_PUBLIC_STUN_URLS` | Google, Twilio | Comma-separated STUN servers for direct transfer |
| `NEXT_PUBLIC_SITE_URL` | detected | Public origin, used for canonical and Open Graph URLs |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Listen address |

If you run more than one instance behind a load balancer, set `SHARE_SECRET`
explicitly so unlock cookies issued by one instance are accepted by the others,
and give every instance the same `DATA_DIR`.

### The site URL

`NEXT_PUBLIC_SITE_URL` matters at **build** time, not run time: canonical and
Open Graph tags are baked into the statically rendered pages. Render and Vercel
are detected automatically (`RENDER_EXTERNAL_URL`, `VERCEL_URL`); anywhere else,
set it during the build or those tags will point at `localhost`.

`robots.txt` and `sitemap.xml` do not depend on it — they read the host from the
request, so they are always correct for whatever domain is being crawled.

## Search engines, sharing and browsers

- Per-page titles and descriptions, canonical URLs, Open Graph and Twitter card
  tags, and a link-preview image generated from the site copy so the two cannot
  drift. The card is drawn with the bundled Liberation faces rather than a
  downloaded font, so it renders identically offline.
- `sitemap.xml` and `robots.txt`, both resolved against the requesting host.
- JSON-LD describing the site and its tools.
- A web manifest, so the app can be installed and opened in its own window.
- Security headers on every response: `X-Content-Type-Options`,
  `Referrer-Policy`, `X-Frame-Options` and a restrictive `Permissions-Policy`.
- A skip link to the main content, for anyone navigating by keyboard.

**Share links are kept out of all of it.** `/f/<id>` carries
`noindex, nofollow, nocache`, is excluded from the sitemap and disallowed in
`robots.txt`, and `Referrer-Policy` stops the link leaking to any site a
document links out to. The link is the only thing protecting the file, so it is
treated as a secret rather than as a page. `/uploads` is likewise not indexed:
it is personal to one browser.

## About the size limit

There is no per-file limit in the application. Uploads are cut into chunks and
each chunk is streamed straight to disk, so neither the browser nor the server
ever holds a whole file in memory. What actually bounds a stored file is free
space on the volume behind `DATA_DIR`, plus any limit your reverse proxy
imposes on a request body — a chunk is `CHUNK_SIZE` bytes, so a proxy limit
above that is enough however large the file is.

**Direct transfer** has no such bound at all. The bytes travel over an
encrypted WebRTC data channel between the two browsers, and this server only
introduces the peers to each other. In browsers that support the File System
Access API (Chrome, Edge) the receiving side writes each chunk straight to the
file the user picked, so memory stays flat regardless of size. Elsewhere the
transfer is buffered in the tab and is limited by available memory, which the
page says before the transfer starts.

Uploads are swept for expiry every fifteen minutes, and on startup.

## Notes on each tool

### Data viewer

`.csv` and `.tsv` are parsed in the browser, in a worker, and never leave the
machine. `.xlsx` and `.xlsm` are parsed on the server with a streaming reader
and the temporary copy is deleted before the response is sent. Rows are
virtualised, so a sheet with tens of thousands of rows still scrolls smoothly.

Legacy `.xls`, `.ods` and `.xlsb` are not supported; the viewer says so and
suggests re-saving as `.xlsx`.

### Markdown preview

Paste Markdown, read it rendered. It shares the Markdown engine and stylesheets
with the exporter, so tables, highlighted code, maths and diagrams all appear
exactly as they would in a PDF — but with no cover page and no contents list,
which is what makes a quick look at a document quick.

Two views: *Reading* drops the paper entirely and sets the text at a
comfortable measure, and *Paper* shows the same document on sheets the size of
the chosen page. The editor pane can be hidden to read full width, and a PDF of
what you are looking at is one button away.

### Markdown to PDF

Supports GitHub-style tables, fenced code with syntax highlighting, task lists,
footnotes, `$inline$` and `$$block$$` maths, ```mermaid diagrams, and a
`\pagebreak` line to force a page break.

Diagrams are drawn in a page of their own rather than in the document. The
document is rendered with JavaScript disabled so that pasted Markdown can never
execute; Mermaid needs a script to run, so instead of relaxing that, its script
runs against the diagram source alone, in a page that holds none of the user's
HTML and can load nothing. The resulting SVG is inlined into the document, which
is still rendered with scripts off, and Mermaid itself runs at `securityLevel:
strict` so a diagram label cannot smuggle markup through. Rendered diagrams are
cached by source, so an unchanged one costs nothing on the next preview.
A diagram that fails to parse becomes a visible error block rather than failing
the export.

The preview pane is rendered by the server from the same stylesheet the
exporter uses, so the two cannot drift apart. Contents-list page numbers are
real: the document is rendered once, the page each heading landed on is read
back from the PDF's own destination table, and it is rendered again with the
numbers filled in. A cover page is printed separately and merged in front so it
carries no header, footer or page number, and internal links are rewritten to
survive that merge.

Documents are rendered with JavaScript disabled and every request other than
the document itself blocked, so pasted Markdown cannot reach local files or
internal network hosts.

### PDF toolkit

Merging, page extraction, rotation and watermarking all run in the browser with
pdf-lib, so documents are never uploaded and no size limit applies. Page
selections use print-dialog syntax: `1-3, 7` or `5-` for everything from five
onwards. Documents carrying only an owner password are opened rather than
rejected, since they are readable.

Several `.md` files can be combined into one document. They are joined with a
hard page break, so each file starts a chapter on a fresh page and its headings
flow into the contents. Reorder them in the file strip above the editor.

A letterhead image can be placed on the cover and repeated in the running
header. It travels as an inline `data:` URI, because the renderer refuses to
fetch anything at render time; a URL is rejected rather than fetched.

The opening heading is only dropped when the cover is actually using it. With
an explicit title set — or several files, where the first heading is chapter one
rather than the document title — it is kept.

### Share a file

Uploads resume: if a chunk fails, the client asks the server how many bytes it
actually holds and carries on from there. Links can carry an expiry, a
password, and a download cap. Behind a password, even the file name is withheld
until the password is given.

Anything not on a short list of safe types is served as an attachment rather
than inline, so an uploaded `.html` or `.svg` can never execute on this origin.

### Request files

The mirror image of a share link, and the security model is inverted with it. A
share link lets whoever holds it *read* one file, so the link itself is the
secret. A request link lets whoever holds it *write*, and anyone you send it to
can pass it on, so it cannot rely on staying secret: it carries hard limits
instead — an expiry, a ceiling on how many files it will take, an optional
password, and a switch to close it.

Reading what arrives needs the owner token, a random value handed back once at
creation and kept in this browser's `localStorage`. The server never ties it to
an account, so the person who made the request is the only one who can list the
submissions or download them — the sender cannot even fetch back the file they
just sent, and neither can anybody else holding its id. Clearing the browser
loses that access for good, which is the cost of not having accounts.

Two smaller decisions follow from the same reasoning. The request is checked for
being open *before* the first chunk is accepted, so a closed or full request
cannot be used as free storage. And the submission is recorded by the server
when the upload completes rather than by the client afterwards, so a sender who
closes the tab the moment the last chunk lands still shows up in the owner's
list rather than leaving an orphaned file on disk.

### Direct transfer

The sender gets a six-character code. The receiver enters it, the two browsers
negotiate a connection, and the file is sent with backpressure so the send
buffer never grows unboundedly. If the peers cannot reach each other directly —
a strict corporate firewall, for instance — the connection fails rather than
falling back to a relay; there is no TURN server configured.

## Planned

None of the following is built yet. They are recorded here so the intent behind
each is clear before anyone starts, and so the list does not get mistaken for a
description of what the app currently does.

### Shareable preview links

Today the Markdown preview is private to your browser: you paste something, you
read it, and that is the end of it. Sending it to somebody means exporting a PDF
or pasting the source and asking them to render it themselves.

The idea is a **Share** button on `/preview` that stores the Markdown and hands
back a link. Opening that link shows the *rendered document* — no editor, no
toolbar, nothing to configure — so the person receiving it reads a page rather
than a file they must first do something with. It is the difference between a
scratchpad and something you can put in a message.

Because it stores content on the server, it belongs to the same machinery as
file sharing: the same expiry, password and revoke options, listed alongside
uploads in `/uploads`, and unavailable on a deployment with no writable disk.
Like a share link, the URL would be the only thing protecting it, so it would
carry the same `noindex` treatment.

### Diff two spreadsheets

Comparing two versions of the same sheet — last month's export against this
one, a colleague's copy against yours — is currently a manual job, and the
viewer does not help with it at all.

The idea is to open two files, choose a column that identifies a row (an id, an
email, a SKU), and get a report of what changed: rows added, rows removed, and
rows where a value moved, with the changed cells highlighted and the old and new
values shown side by side. Columns that appear in one file and not the other get
called out too, since a changed export format is a common reason two sheets stop
matching.

Everything needed for this already exists — the parsers, the virtualised grid,
the value coercion that knows `1,200` and `$1,200` are the same number — so the
work is mostly the matching logic and a way to present it. Nothing else in this
app does it, which is what makes it worth building.

### Export to DOCX and HTML

The Markdown studio produces PDFs, and a PDF is final. That is right for
sending something out, and wrong when the person receiving it has to edit it,
comment on it, or put it through a review process that runs on tracked changes.

Two more outputs would cover that:

- **DOCX**, for anyone who needs to edit the result in Word or Google Docs.
  Headings, tables, lists, code blocks and images would map onto real Word
  styles rather than a flat blob of text, so the document stays editable and
  restyleable at the other end.
- **Standalone HTML**, a single file with the stylesheet, fonts and diagrams
  inlined. Nothing to serve and nothing to fetch, so it can be emailed, dropped
  on a static host, or opened straight from disk and still look the same.

Both would reuse the existing theme stylesheets, so a document exported three
ways would look like three versions of one thing rather than three different
documents.

### Table of figures

Long documents refer to their own contents — "see Figure 3", "the totals in
Table 2" — and doing that by hand breaks the moment anything is inserted
above.

The idea is to number captioned images, tables and diagrams automatically, and
to list them after the contents with the page each one falls on. The page
numbers would be resolved the same way the contents list already resolves its
own: render once, read back from the PDF where everything landed, then render
again with the numbers filled in. Cross-references in the text would pick up the
same numbers, so inserting a figure halfway through renumbers everything that
follows rather than leaving the prose wrong.

This matters mainly for reports and papers — the same documents that already
want the cover, the contents and the section numbering.
