# Useful Tools

Four file tools in one small Next.js app:

| Tool | Path | What it does |
| --- | --- | --- |
| Data viewer | `/viewer` | Reads CSV, TSV and Excel workbooks as a sortable, searchable table |
| Markdown to PDF | `/markdown` | Typesets Markdown into a PDF with a cover, contents, headers and page numbers |
| Share a file | `/share` | Chunked resumable upload of any file, with a share link |
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

## Configuration

Every setting is optional. See `.env.example`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATA_DIR` | `./data` | Where uploaded files and their metadata live |
| `MAX_FILE_SIZE` | `0` | Per-file ceiling in bytes; `0` means no limit |
| `CHUNK_SIZE` | `8388608` | Upload chunk size in bytes |
| `DEFAULT_EXPIRY_HOURS` | `0` | Default link lifetime; `0` means links never expire |
| `MAX_PREVIEW_ROWS` | `50000` | Row cap for a spreadsheet preview |
| `MAX_PARSE_BYTES` | `209715200` | Largest file the viewer will parse |
| `SHARE_SECRET` | generated | Key for signing password-unlock cookies |
| `CHROME_PATH` | auto-detected | Chromium executable used for PDF rendering |
| `NEXT_PUBLIC_STUN_URLS` | Google, Twilio | Comma-separated STUN servers for direct transfer |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Listen address |

If you run more than one instance behind a load balancer, set `SHARE_SECRET`
explicitly so unlock cookies issued by one instance are accepted by the others,
and give every instance the same `DATA_DIR`.

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

### Markdown to PDF

Supports GitHub-style tables, fenced code with syntax highlighting, task lists,
footnotes, `$inline$` and `$$block$$` maths, and a `\pagebreak` line to force a
page break.

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

### Share a file

Uploads resume: if a chunk fails, the client asks the server how many bytes it
actually holds and carries on from there. Links can carry an expiry, a
password, and a download cap. Behind a password, even the file name is withheld
until the password is given.

Anything not on a short list of safe types is served as an attachment rather
than inline, so an uploaded `.html` or `.svg` can never execute on this origin.

### Direct transfer

The sender gets a six-character code. The receiver enters it, the two browsers
negotiate a connection, and the file is sent with backpressure so the send
buffer never grows unboundedly. If the peers cannot reach each other directly —
a strict corporate firewall, for instance — the connection fails rather than
falling back to a relay; there is no TURN server configured.
