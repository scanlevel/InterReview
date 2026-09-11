"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { useState } from "react";

export default function InterviewerStage({
  children,
  showLabel = true,
  className = "",
  imageSrc,
}: {
  children?: ReactNode;
  showLabel?: boolean;
  className?: string;
  imageSrc?: string | null;
}) {
  const [failedImageSrc, setFailedImageSrc] = useState<string | null>(null);

  return (
    <div className={["relative aspect-video overflow-hidden rounded-lg border border-[#2c405a] bg-[#16283f] shadow-inner", className].filter(Boolean).join(" ")}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(59,130,246,0.2),transparent_58%)]" />
      {showLabel && (
        <div className="absolute left-3 top-3 z-10 rounded-full bg-slate-900/75 px-2.5 py-1 text-xs font-medium text-slate-200">
          가상 면접관
        </div>
      )}
      <div className="absolute inset-0">
        {imageSrc && imageSrc !== failedImageSrc ? (
          <Image
            src={imageSrc}
            alt="가상 면접관 사진"
            fill
            sizes="100vw"
            className="object-contain"
            onError={() => setFailedImageSrc(imageSrc)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center px-10 py-8">
            <svg
              aria-label="가상 면접관 아바타"
              role="img"
              viewBox="0 0 240 180"
              className="h-full w-full max-w-[15rem]"
            >
              <circle cx="120" cy="70" r="34" fill="#dbeafe" />
              <path
                d="M82 64c4-31 20-46 38-46s34 15 38 46c-13-9-25-13-38-13s-25 4-38 13Z"
                fill="#334155"
              />
              <circle cx="108" cy="70" r="4" fill="#1e293b" />
              <circle cx="132" cy="70" r="4" fill="#1e293b" />
              <path d="M108 88c8 6 16 6 24 0" fill="none" stroke="#1e293b" strokeWidth="4" strokeLinecap="round" />
              <path d="M58 166c5-38 28-57 62-57s57 19 62 57" fill="#60a5fa" />
              <path d="M91 120h58l-29 33-29-33Z" fill="#eff6ff" />
              <path d="M115 120h10v42h-10z" fill="#2563eb" />
            </svg>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
