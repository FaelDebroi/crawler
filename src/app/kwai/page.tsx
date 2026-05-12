import Link from "next/link";
import KwaiImport from "@/components/KwaiImport";

function KwaiIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 3h4v7.5l5.5-7.5H18l-6.5 8.5L18 21h-4.5L8 13.5V21H4V3z" />
    </svg>
  );
}

export default function KwaiPage() {
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
            <KwaiIcon className="w-4 h-4 text-orange-400" />
            <span className="text-sm font-medium text-white">Kwai</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-8 py-8">
        <div className="mb-8">
          <h1 className="text-xl font-bold text-white">Kwai Crawler</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Importe vídeos e publique automaticamente no Kwai · Login via QR Code
          </p>
        </div>

        <KwaiImport />
      </main>
    </div>
  );
}
