import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "InterReview",
  description: "시선·음성 측정값을 보여주는 AI 모의면접",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
