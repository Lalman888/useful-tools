import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

export const alt = `${SITE_NAME} — ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Without an explicit font, the image generator fetches one over the network,
 * which fails on a machine with no egress and leaves the text unrendered. Use
 * the faces already bundled for the PDF exporter instead, so the card is
 * produced identically everywhere and offline.
 */
function loadFont(file: string): ArrayBuffer | null {
  try {
    const buffer = fs.readFileSync(
      path.join(/* turbopackIgnore: true */ process.cwd(), "assets", "fonts", file)
    );
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;
  } catch {
    return null;
  }
}

export default function OpenGraphImage() {
  const regular = loadFont("LiberationSans-Regular.ttf");
  const bold = loadFont("LiberationSans-Bold.ttf");

  const fonts = [
    regular && { name: "Liberation Sans", data: regular, weight: 400 as const, style: "normal" as const },
    bold && { name: "Liberation Sans", data: bold, weight: 700 as const, style: "normal" as const },
  ].filter((font) => font !== null);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0f172a",
          padding: "72px",
          fontFamily: "Liberation Sans",
          color: "#f8fafc",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          {/* Drawn rather than set as a glyph, so no character has to exist in
              the font for the mark to appear. */}
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "14px",
              background: "#f8fafc",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: "7px",
              padding: "0 13px",
            }}
          >
            <div style={{ height: "5px", borderRadius: "3px", background: "#0f172a" }} />
            <div style={{ height: "5px", borderRadius: "3px", background: "#0f172a" }} />
            <div
              style={{
                height: "5px",
                width: "18px",
                borderRadius: "3px",
                background: "#0f172a",
              }}
            />
          </div>
          <div style={{ fontSize: "30px", fontWeight: 700, letterSpacing: "-0.5px" }}>
            {SITE_NAME}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "26px" }}>
          <div style={{ width: "96px", height: "6px", background: "#38bdf8" }} />
          <div
            style={{
              fontSize: "68px",
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: "-2px",
              maxWidth: "920px",
            }}
          >
            {SITE_TAGLINE}
          </div>
        </div>

        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
          {["CSV & Excel viewer", "Markdown to PDF", "PDF toolkit", "File sharing"].map(
            (label) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  fontSize: "24px",
                  color: "#cbd5e1",
                  border: "1px solid #334155",
                  borderRadius: "999px",
                  padding: "10px 22px",
                }}
              >
                {label}
              </div>
            )
          )}
        </div>
      </div>
    ),
    { ...size, ...(fonts.length > 0 ? { fonts } : {}) }
  );
}
