import Link from "next/link";
import CredentialsCard from "@/components/CredentialsCard";
import TikTokImport from "@/components/TikTokImport";

export default function TikTokPage() {
  const email = process.env.TIKTOK_EMAIL ?? "";
  const password = process.env.TIKTOK_PASSWORD ?? "";

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-zinc-800 px-8 py-5">
        <div className="mx-auto max-w-6xl flex items-center gap-4">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm text-zinc-400 transition-colors hover:text-white"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
            </svg>
            Dashboard
          </Link>
          <span className="text-zinc-700">/</span>
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white">
              <path d="M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
            </svg>
            <span className="text-sm font-medium text-white">TikTok</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-8 py-8">
        {/* Top row: title + credentials */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">TikTok Crawler</h1>
            <p className="mt-1 text-sm text-zinc-400">Importe vídeos e agende postagens automáticas</p>
          </div>
          <div className="w-full sm:w-80 shrink-0">
            <CredentialsCard email={email} password={password} />
          </div>
        </div>

        {/* Import area */}
        <TikTokImport />
      </main>
    </div>
  );
}
