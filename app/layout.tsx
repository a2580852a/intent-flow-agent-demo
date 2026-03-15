import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { TopNav } from "@/components/top-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Intent-Flow Agent Demo",
  description: "A web platform for RAG-based task agents with multi-level feedback loops."
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="app-shell">
          <header className="topbar">
            <Link className="brand" href="/">
              <span className="brand-mark">IFD</span>
              <div>
                <strong>Intent-Flow Agent Demo</strong>
                <small>RAG + Multi-Feedback Platform</small>
              </div>
            </Link>
            <TopNav />
          </header>
          <main className="content-shell">{children}</main>
        </div>
      </body>
    </html>
  );
}
