import { ImageResponse } from "next/og";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE } from "@/lib/site";

export const alt = SITE_TITLE;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Share-card image — warm sand palette matching the site (no 3D screenshot). */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "linear-gradient(145deg, #131110 0%, #1b1815 55%, #3a241a 100%)",
          color: "#f3eee7",
          fontFamily: "Georgia, 'Times New Roman', serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 28,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#a39a8e",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: "#3a241a",
              border: "2px solid #e0764f",
              display: "flex",
            }}
          />
          Mert Soylu · {SITE_NAME}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              fontSize: 88,
              fontWeight: 600,
              letterSpacing: "-0.03em",
              lineHeight: 1.05,
            }}
          >
            {SITE_NAME}
          </div>
          <div
            style={{
              fontSize: 32,
              lineHeight: 1.35,
              color: "#a39a8e",
              maxWidth: 900,
              fontFamily: "system-ui, sans-serif",
              fontWeight: 400,
            }}
          >
            {SITE_DESCRIPTION.split(" / ")[0]}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 24,
            color: "#a39a8e",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <span>sergi.mertsoylu.dev</span>
          <span style={{ color: "#e0764f" }}>GitHub → trees</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
