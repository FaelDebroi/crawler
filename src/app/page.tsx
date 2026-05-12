import Link from "next/link";

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
      <path d="M12 1a5 5 0 0 1 5 5v2h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h1V6a5 5 0 0 1 5-5zm0 11a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0-9a3 3 0 0 0-3 3v2h6V6a3 3 0 0 0-3-3z" />
    </svg>
  );
}

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    </svg>
  );
}

function KwaiIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 3h4v7.5l5.5-7.5H18l-6.5 8.5L18 21h-4.5L8 13.5V21H4V3z" />
    </svg>
  );
}

function YouTubeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.54 3.5 12 3.5 12 3.5s-7.54 0-9.38.55A3.02 3.02 0 0 0 .5 6.19C0 8.04 0 12 0 12s0 3.96.5 5.81a3.02 3.02 0 0 0 2.12 2.14C4.46 20.5 12 20.5 12 20.5s7.54 0 9.38-.55a3.02 3.02 0 0 0 2.12-2.14C24 15.96 24 12 24 12s0-3.96-.5-5.81zM9.75 15.5v-7l6.5 3.5-6.5 3.5z" />
    </svg>
  );
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
    </svg>
  );
}

function TwitterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
    </svg>
  );
}

type Platform = {
  id: string;
  name: string;
  locked: boolean;
  discontinued?: boolean;
  href?: string;
  Icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  accentColor: string;
};

const platforms: Platform[] = [
  {
    id: "tiktok",
    name: "TikTok",
    locked: false,
    href: "/tiktok",
    Icon: TikTokIcon,
    iconColor: "text-white",
    accentColor: "#EE1D52",
  },
  {
    id: "kwai",
    name: "Kwai",
    locked: false,
    href: "/kwai",
    Icon: KwaiIcon,
    iconColor: "text-orange-400",
    accentColor: "#FF6900",
  },
  {
    id: "youtube",
    name: "YouTube",
    locked: true,
    Icon: YouTubeIcon,
    iconColor: "text-zinc-500",
    accentColor: "#FF0000",
  },
  {
    id: "facebook",
    name: "Facebook",
    locked: true,
    Icon: FacebookIcon,
    iconColor: "text-zinc-500",
    accentColor: "#1877F2",
  },
  {
    id: "twitter",
    name: "Twitter",
    locked: true,
    Icon: TwitterIcon,
    iconColor: "text-zinc-500",
    accentColor: "#1DA1F2",
  },
  {
    id: "instagram",
    name: "Instagram",
    locked: true,
    Icon: InstagramIcon,
    iconColor: "text-zinc-500",
    accentColor: "#E1306C",
  },
];

function ActiveCard({ platform }: { platform: Platform }) {
  const { Icon, name, href, accentColor } = platform;
  return (
    <Link
      href={href!}
      className="group relative flex flex-col items-center justify-center gap-4 rounded-2xl border border-zinc-700 bg-zinc-900 p-8 transition-all duration-200 hover:border-zinc-500 hover:bg-zinc-800 hover:shadow-lg"
      style={{ ["--accent" as string]: accentColor }}
    >
      <div
        className="absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{ boxShadow: `inset 0 0 0 1px ${accentColor}33` }}
      />
      <Icon className={`h-14 w-14 ${platform.iconColor} transition-transform duration-200 group-hover:scale-110`} />
      <div className="flex flex-col items-center gap-1">
        <span className="text-base font-semibold text-white">{name}</span>
        <span
          className="rounded-full px-2.5 py-0.5 text-xs font-medium"
          style={{ backgroundColor: `${accentColor}22`, color: accentColor }}
        >
          Ativo
        </span>
      </div>
    </Link>
  );
}

function LockedCard({ platform }: { platform: Platform }) {
  const { Icon, name, discontinued } = platform;
  return (
    <div className="relative flex flex-col items-center justify-center gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-8 cursor-not-allowed select-none">
      <div className="absolute right-3 top-3 text-zinc-600">
        <LockIcon />
      </div>
      <Icon className={`h-14 w-14 ${platform.iconColor} opacity-40`} />
      <div className="flex flex-col items-center gap-1">
        <span className="text-base font-semibold text-zinc-500">{name}</span>
        {discontinued ? (
          <span className="rounded-full bg-red-950 px-2.5 py-0.5 text-xs font-medium text-red-500">
            Plataforma encerrada
          </span>
        ) : (
          <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-600">
            Em breve
          </span>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-zinc-800 px-8 py-6">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-2xl font-bold tracking-tight text-white">Social Crawler</h1>
          <p className="mt-1 text-sm text-zinc-400">Gerencie seus crawlers de redes sociais</p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-8 py-10">
        <div className="mb-6">
          <h2 className="text-sm font-medium uppercase tracking-widest text-zinc-500">Plataformas</h2>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {platforms.map((platform) =>
            platform.locked ? (
              <LockedCard key={platform.id} platform={platform} />
            ) : (
              <ActiveCard key={platform.id} platform={platform} />
            )
          )}
        </div>
      </main>
    </div>
  );
}
