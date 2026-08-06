import { ImageResponse } from "next/og";

// Next.js picks this up automatically as the site favicon/app icon — no
// static image file needed, it's rendered on demand and cached.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#171717",
          borderRadius: "50%",
          color: "white",
          fontSize: 18,
          fontWeight: 600,
          fontFamily: "sans-serif",
        }}
      >
        P
      </div>
    ),
    { ...size },
  );
}
