import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "bibliotool — библиометрический анализ с семантическим слоем",
  description: "OpenAlex · сети · семантические кластеры · LLM-описание",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-30 border-b hairline bg-surface/90 backdrop-blur">
          <div className="mx-auto max-w-7xl px-5 h-14 flex items-center gap-6">
            <Link href="/" className="font-semibold tracking-tight">
              <span className="inline-block w-2.5 h-2.5 rounded-sm mr-2 align-middle" style={{ background: "var(--accent)" }} />
              bibliotool
            </Link>
            <nav className="flex gap-5 text-sm text-ink-2">
              <Link href="/" className="hover:text-ink">Прогоны</Link>
              <Link href="/about" className="hover:text-ink">О методе</Link>
              <a href="http://localhost:8000/docs" target="_blank" className="hover:text-ink">API</a>
            </nav>
            <span className="ml-auto text-xs text-muted">OpenAlex · CC0 · локальный LLM</span>
          </div>
        </header>
        <main className="flex-1 mx-auto w-full max-w-7xl px-5 py-6">{children}</main>
        <footer className="border-t hairline text-xs text-muted px-5 py-4 text-center">
          Проектная работа «Bibliometric Analysis as a Method of Scientific Research» · Bucheon University in Tashkent · 2026
        </footer>
      </body>
    </html>
  );
}
