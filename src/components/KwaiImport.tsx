"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import JSZip from "jszip";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PostStatus = "idle" | "uploading" | "queued" | "running" | "done" | "error";

type VideoItem = {
  id: string;
  file: File;
  url: string;
  title: string;
  comment: string;
  hashtags: string[];
  postStatus: PostStatus;
  jobId?: string;
  postError?: string;
  logs: string[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VIDEO_EXTS = new Set([".mp4", ".mov", ".avi", ".webm", ".mkv", ".m4v"]);

function isVideo(name: string) {
  return VIDEO_EXTS.has(name.slice(name.lastIndexOf(".")).toLowerCase());
}

function makeItem(file: File, globalTags: string[], comment = ""): VideoItem {
  return {
    id: crypto.randomUUID(),
    file,
    url: URL.createObjectURL(file),
    title: file.name.replace(/\.[^.]+$/, ""),
    comment,
    hashtags: [...globalTags],
    postStatus: "idle",
    logs: [],
  };
}

// ─── HashtagInput ─────────────────────────────────────────────────────────────

function HashtagInput({
  tags,
  onChange,
  placeholder = "Adicionar hashtag (Enter ou vírgula)",
}: {
  tags: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  const commit = (raw: string) => {
    const tag = raw.trim().replace(/^#+/, "");
    if (tag && !tags.includes(tag)) onChange([...tags, tag]);
    setDraft("");
  };

  return (
    <div className="flex flex-wrap gap-1.5 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 focus-within:border-zinc-500 transition-colors">
      {tags.map((tag) => (
        <span key={tag} className="flex items-center gap-1 rounded-lg bg-zinc-700 px-2 py-0.5 text-xs text-zinc-200">
          #{tag}
          <button type="button" onClick={() => onChange(tags.filter((t) => t !== tag))} className="leading-none text-zinc-400 hover:text-white transition-colors">×</button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(draft); }
          else if (e.key === "Backspace" && !draft && tags.length) onChange(tags.slice(0, -1));
        }}
        onBlur={() => draft && commit(draft)}
        placeholder={tags.length === 0 ? placeholder : ""}
        className="min-w-[140px] flex-1 bg-transparent text-sm text-white placeholder-zinc-500 outline-none"
      />
    </div>
  );
}

// ─── StatusBadge ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<PostStatus, { label: string; className: string }> = {
  idle:      { label: "Aguardando",  className: "bg-zinc-700 text-zinc-300" },
  uploading: { label: "Enviando…",   className: "bg-blue-900/60 text-blue-300" },
  queued:    { label: "Na fila",     className: "bg-yellow-900/60 text-yellow-300" },
  running:   { label: "Postando…",   className: "bg-orange-900/60 text-orange-300 animate-pulse" },
  done:      { label: "Postado ✓",   className: "bg-emerald-900/60 text-emerald-300" },
  error:     { label: "Erro",        className: "bg-red-900/60 text-red-300" },
};

function StatusBadge({ status, error }: { status: PostStatus; error?: string }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span title={error} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

// ─── LogPanel ────────────────────────────────────────────────────────────────

function LogPanel({ logs }: { logs: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [logs]);
  if (!logs.length) return null;
  return (
    <div ref={ref} className="max-h-36 overflow-y-auto rounded-lg bg-zinc-950 px-3 py-2 font-mono text-[10px] leading-relaxed text-zinc-400 space-y-px">
      {logs.map((line, i) => <div key={i} className="break-all">{line}</div>)}
    </div>
  );
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${on ? "bg-orange-500" : "bg-zinc-600"}`}>
      <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${on ? "translate-x-4" : "translate-x-0"}`} />
    </button>
  );
}

// ─── VideoCard ────────────────────────────────────────────────────────────────

function VideoCard({
  item,
  onChange,
  onRemove,
  onPost,
}: {
  item: VideoItem;
  onChange: (id: string, patch: Partial<VideoItem>) => void;
  onRemove: (id: string) => void;
  onPost: (id: string) => void;
}) {
  const busy = item.postStatus !== "idle" && item.postStatus !== "error";
  const terminal = item.postStatus === "done";

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
      {/* Mini player */}
      <div className="relative overflow-hidden rounded-xl bg-black">
        <video src={item.url} controls preload="metadata" className="h-44 w-full object-contain" />
        {!busy && !terminal && (
          <button type="button" onClick={() => onRemove(item.id)} title="Remover"
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-sm leading-none text-white hover:bg-black transition-colors">
            ×
          </button>
        )}
      </div>

      {/* Título */}
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-500">Nome do post</label>
        <input type="text" value={item.title} disabled={busy || terminal}
          onChange={(e) => onChange(item.id, { title: e.target.value })}
          className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white outline-none focus:border-zinc-500 transition-colors disabled:opacity-50" />
      </div>

      {/* Comentário */}
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-500">Comentário</label>
        <textarea value={item.comment} disabled={busy || terminal}
          onChange={(e) => onChange(item.id, { comment: e.target.value })}
          rows={2}
          placeholder="Comentário que aparecerá na publicação…"
          className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-zinc-500 transition-colors disabled:opacity-50" />
      </div>

      {/* Hashtags */}
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-500">Hashtags</label>
        <HashtagInput tags={item.hashtags} onChange={(hashtags) => onChange(item.id, { hashtags })} placeholder="Adicionar hashtag" />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1">
        <StatusBadge status={item.postStatus} error={item.postError} />
        {!terminal && (
          <button type="button" disabled={busy} onClick={() => onPost(item.id)}
            className="rounded-xl bg-orange-500 px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">
            {item.postStatus === "error" ? "Tentar novamente" : "Postar"}
          </button>
        )}
      </div>

      {item.postStatus === "error" && item.postError && (
        <p className="rounded-lg bg-red-950/50 px-3 py-2 text-xs text-red-400">{item.postError}</p>
      )}

      <LogPanel logs={item.logs} />
    </div>
  );
}

// ─── DropZone ─────────────────────────────────────────────────────────────────

function DropZone({ loading, onFiles }: { loading: boolean; onFiles: (files: File[]) => void }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      onDrop={(e) => { e.preventDefault(); setDragging(false); onFiles(Array.from(e.dataTransfer.files)); }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onClick={() => inputRef.current?.click()}
      className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-8 py-12 transition-colors
        ${dragging ? "border-orange-500 bg-orange-900/10" : "border-zinc-700 bg-zinc-900/40 hover:border-zinc-600 hover:bg-zinc-900"}`}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-800">
        {loading ? (
          <svg className="h-5 w-5 animate-spin text-zinc-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6 text-zinc-400">
            <path d="M18 15v3H6v-3H4v3c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-3h-2zm-1-4-1.41-1.41L13 12.17V4h-2v8.17L8.41 9.59 7 11l5 5 5-5z" />
          </svg>
        )}
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-zinc-300">{loading ? "Extraindo arquivos..." : "Arraste vídeos ou uma pasta ZIP"}</p>
        <p className="mt-0.5 text-xs text-zinc-500">MP4, MOV, AVI, WEBM, MKV · ou .zip com vídeos</p>
      </div>
      {!loading && (
        <button type="button" className="rounded-lg bg-zinc-700 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-600">
          Selecionar arquivos
        </button>
      )}
      <input ref={inputRef} type="file" accept="video/*,.zip" multiple className="hidden"
        onChange={(e) => { if (e.target.files?.length) { onFiles(Array.from(e.target.files)); e.target.value = ""; } }} />
    </div>
  );
}

// ─── Hashtag groups ───────────────────────────────────────────────────────────

type GroupId = "principais" | "virais" | "custom";

type HashtagGroup = {
  id: GroupId;
  label: string;
  tags: string[];
  enabled: boolean;
  toggleable: boolean;
};

const DEFAULT_GROUPS: HashtagGroup[] = [
  {
    id: "principais",
    label: "Principais",
    tags: ["kwai", "kwaistar", "kwaibrasil", "kwaiapp", "fyp", "foryou", "parati", "viral", "foryoupage", "fy"],
    enabled: true,
    toggleable: true,
  },
  {
    id: "virais",
    label: "Virais",
    tags: ["trending", "viralvideo", "explorepage", "trendingnow", "viralpost", "kwaitrend", "explore", "trendingvideo", "viraltiktok", "kwaimusica"],
    enabled: true,
    toggleable: true,
  },
  {
    id: "custom",
    label: "Minhas",
    tags: [],
    enabled: true,
    toggleable: false,
  },
];

function effectiveTags(groups: HashtagGroup[]): string[] {
  return [...new Set(groups.filter((g) => g.enabled).flatMap((g) => g.tags))];
}

function GlobalHashtagPanel({
  groups,
  onGroupsChange,
}: {
  groups: HashtagGroup[];
  onGroupsChange: (next: HashtagGroup[]) => void;
}) {
  const toggle = (id: GroupId) =>
    onGroupsChange(groups.map((g) => (g.id === id ? { ...g, enabled: !g.enabled } : g)));

  const setTags = (id: GroupId, tags: string[]) =>
    onGroupsChange(groups.map((g) => (g.id === id ? { ...g, tags } : g)));

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {groups.map((group) => (
        <div
          key={group.id}
          className={`flex flex-col gap-3 rounded-2xl border bg-zinc-900 p-4 transition-colors ${
            group.enabled ? "border-zinc-700" : "border-zinc-800 opacity-60"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-zinc-200">{group.label}</span>
            {group.toggleable && <Toggle on={group.enabled} onChange={() => toggle(group.id)} />}
          </div>

          {group.id === "custom" ? (
            <HashtagInput
              tags={group.tags}
              onChange={(tags) => setTags(group.id, tags)}
              placeholder="Adicionar hashtag (Enter ou vírgula)"
            />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {group.tags.map((tag) => (
                <span key={tag} className="rounded-lg bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function KwaiImport() {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [groups, setGroups] = useState<HashtagGroup[]>(DEFAULT_GROUPS);
  const [globalComment, setGlobalComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [adbStatus, setAdbStatus] = useState<"checking" | "connected" | "disconnected">("checking");
  const [adbDevices, setAdbDevices] = useState<string[]>([]);

  const propagate = (oldGroups: HashtagGroup[], newGroups: HashtagGroup[]) => {
    const prev = effectiveTags(oldGroups);
    const next = effectiveTags(newGroups);
    const added = next.filter((t) => !prev.includes(t));
    const removed = prev.filter((t) => !next.includes(t));
    if (!added.length && !removed.length) return;
    setVideos((vs) =>
      vs.map((v) => ({
        ...v,
        hashtags: [
          ...v.hashtags.filter((t) => !removed.includes(t)),
          ...added.filter((t) => !v.hashtags.includes(t)),
        ],
      }))
    );
  };

  const handleGroupsChange = (next: HashtagGroup[]) => {
    propagate(groups, next);
    setGroups(next);
  };

  const handleFiles = useCallback(
    async (files: File[]) => {
      const activeTags = effectiveTags(groups);
      setLoading(true);
      try {
        const items: VideoItem[] = [];
        for (const file of files) {
          if (file.name.toLowerCase().endsWith(".zip")) {
            const zip = await JSZip.loadAsync(file);
            for (const [, entry] of Object.entries(zip.files)) {
              if (entry.dir || !isVideo(entry.name)) continue;
              const blob = await entry.async("blob");
              const name = entry.name.split("/").pop() ?? entry.name;
              const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
              items.push(makeItem(new File([blob], name, { type: `video/${ext}` }), activeTags, globalComment));
            }
          } else if (isVideo(file.name)) {
            items.push(makeItem(file, activeTags, globalComment));
          }
        }
        setVideos((prev) => [...prev, ...items]);
      } finally {
        setLoading(false);
      }
    },
    [groups, globalComment]
  );

  const updateVideo = (id: string, patch: Partial<VideoItem>) =>
    setVideos((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));

  const removeVideo = (id: string) => {
    setVideos((prev) => {
      const item = prev.find((v) => v.id === id);
      if (item) URL.revokeObjectURL(item.url);
      return prev.filter((v) => v.id !== id);
    });
  };

  const handlePost = useCallback(async (id: string) => {
    const item = videos.find((v) => v.id === id);
    if (!item) return;

    updateVideo(id, { postStatus: "uploading", postError: undefined, logs: [] });

    try {
      const fd = new FormData();
      fd.append("video", item.file, item.file.name);
      fd.append("title", item.title);
      fd.append("comment", item.comment);
      fd.append("hashtags", JSON.stringify(item.hashtags));
      const res = await fetch("/api/kwai/post", { method: "POST", body: fd });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      updateVideo(id, { postStatus: "queued", jobId: data.jobId });
    } catch (err) {
      updateVideo(id, {
        postStatus: "error",
        postError: err instanceof Error ? err.message : "Erro desconhecido",
      });
    }
  }, [videos]);

  const handlePostAll = useCallback(() => {
    videos.filter((v) => v.postStatus === "idle" || v.postStatus === "error").forEach((v) => handlePost(v.id));
  }, [videos, handlePost]);

  // Poll job status every 3s
  useEffect(() => {
    const inFlight = videos.filter((v) => v.jobId && v.postStatus !== "done" && v.postStatus !== "error");
    if (!inFlight.length) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/kwai/status");
        const { jobs } = await res.json() as {
          jobs: Record<string, { status: PostStatus; error?: string; logs: string[] }>;
        };
        setVideos((prev) =>
          prev.map((v) => {
            if (!v.jobId) return v;
            const job = jobs[v.jobId];
            if (!job) return v;
            return { ...v, postStatus: job.status, postError: job.error, logs: job.logs ?? [] };
          })
        );
      } catch { /* ignore */ }
    }, 3_000);

    return () => clearInterval(interval);
  }, [videos]);

  const postableCount = videos.filter((v) => v.postStatus === "idle" || v.postStatus === "error").length;

  const checkAdb = async () => {
    setAdbStatus("checking");
    try {
      const res = await fetch("/api/kwai/login");
      const data = await res.json() as { connected: boolean; devices: string[]; error?: string };
      setAdbStatus(data.connected ? "connected" : "disconnected");
      setAdbDevices(data.devices ?? []);
    } catch {
      setAdbStatus("disconnected");
    }
  };

  useEffect(() => { checkAdb(); }, []);

  return (
    <div className="flex flex-col gap-6">

      {/* ADB status card */}
      <div className={`rounded-2xl border p-4 transition-colors ${
        adbStatus === "connected" ? "border-emerald-700 bg-emerald-950/20" :
        adbStatus === "disconnected" ? "border-amber-700 bg-amber-950/20" :
        "border-zinc-700 bg-zinc-900"
      }`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${
                adbStatus === "connected" ? "bg-emerald-400" :
                adbStatus === "disconnected" ? "bg-amber-400 animate-pulse" :
                "bg-zinc-500 animate-pulse"
              }`} />
              <p className="text-sm font-medium text-zinc-200">
                {adbStatus === "connected" ? `Emulador conectado (${adbDevices.join(", ")})` :
                 adbStatus === "disconnected" ? "Emulador não detectado" :
                 "Verificando ADB..."}
              </p>
            </div>
            {adbStatus === "disconnected" && (
              <div className="mt-2 space-y-1 text-xs text-zinc-400">
                <p>1. Abra o <strong className="text-zinc-200">BlueStacks</strong> ou <strong className="text-zinc-200">LDPlayer</strong></p>
                <p>2. Habilite ADB nas configurações do emulador</p>
                <p>3. Instale o app <strong className="text-zinc-200">Kwai</strong> e faça login manualmente uma vez</p>
                <p>4. No terminal: <code className="rounded bg-zinc-800 px-1">adb connect 127.0.0.1:5555</code></p>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={checkAdb}
            className="shrink-0 rounded-xl border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors"
          >
            Verificar
          </button>
        </div>
      </div>

      {/* Hashtag groups */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium text-zinc-300">Hashtags globais</p>
          <p className="text-xs text-zinc-500">
            {effectiveTags(groups).length} ativas · aplicadas em todos os vídeos
          </p>
        </div>
        <GlobalHashtagPanel groups={groups} onGroupsChange={handleGroupsChange} />
      </div>

      {/* Comentário global */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <label className="mb-2 block text-sm font-medium text-zinc-200">
          Comentário global
          <span className="ml-2 text-xs font-normal text-zinc-500">aplicado em todos os vídeos importados</span>
        </label>
        <textarea
          value={globalComment}
          onChange={(e) => setGlobalComment(e.target.value)}
          rows={3}
          placeholder="Comentário que será postado automaticamente após cada publicação…"
          className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-zinc-500 transition-colors"
        />
      </div>

      {/* Mostrar navegador */}
      {/* Drop zone */}
      <DropZone loading={loading} onFiles={handleFiles} />

      {/* Cards */}
      {videos.length > 0 && (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-zinc-400">
              <span className="font-semibold text-white">{videos.length}</span>{" "}
              vídeo{videos.length !== 1 ? "s" : ""} importado{videos.length !== 1 ? "s" : ""}
            </p>
            <div className="flex items-center gap-3">
              {postableCount > 0 && (
                <button type="button" onClick={handlePostAll}
                  className="rounded-xl bg-orange-500 px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90">
                  Postar todos ({postableCount})
                </button>
              )}
              <button type="button"
                onClick={() => { videos.forEach((v) => URL.revokeObjectURL(v.url)); setVideos([]); }}
                className="text-xs text-zinc-500 transition-colors hover:text-zinc-300">
                Limpar todos
              </button>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {videos.map((item) => (
              <VideoCard key={item.id} item={item} onChange={updateVideo} onRemove={removeVideo} onPost={handlePost} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
