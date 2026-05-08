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
  hashtags: string[];
  scheduledDate: string;
  postStatus: PostStatus;
  jobId?: string;
  postError?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VIDEO_EXTS = new Set([".mp4", ".mov", ".avi", ".webm", ".mkv", ".m4v"]);

function isVideo(name: string) {
  return VIDEO_EXTS.has(name.slice(name.lastIndexOf(".")).toLowerCase());
}

function makeItem(file: File, globalTags: string[]): VideoItem {
  return {
    id: crypto.randomUUID(),
    file,
    url: URL.createObjectURL(file),
    title: file.name.replace(/\.[^.]+$/, ""),
    hashtags: [...globalTags],
    scheduledDate: "",
    postStatus: "idle",
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
        <span
          key={tag}
          className="flex items-center gap-1 rounded-lg bg-zinc-700 px-2 py-0.5 text-xs text-zinc-200"
        >
          #{tag}
          <button
            type="button"
            onClick={() => onChange(tags.filter((t) => t !== tag))}
            className="leading-none text-zinc-400 hover:text-white transition-colors"
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && !draft && tags.length) {
            onChange(tags.slice(0, -1));
          }
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
  running:   { label: "Postando…",   className: "bg-indigo-900/60 text-indigo-300 animate-pulse" },
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
        <video
          src={item.url}
          controls
          preload="metadata"
          className="h-44 w-full object-contain"
        />
        {!busy && !terminal && (
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            title="Remover"
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-sm leading-none text-white hover:bg-black transition-colors"
          >
            ×
          </button>
        )}
      </div>

      {/* Título */}
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-500">Título</label>
        <input
          type="text"
          value={item.title}
          disabled={busy || terminal}
          onChange={(e) => onChange(item.id, { title: e.target.value })}
          className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white outline-none focus:border-zinc-500 transition-colors disabled:opacity-50"
        />
      </div>

      {/* Hashtags */}
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-500">Hashtags</label>
        <HashtagInput
          tags={item.hashtags}
          onChange={(hashtags) => onChange(item.id, { hashtags })}
          placeholder="Adicionar hashtag"
        />
      </div>

      {/* Data de postagem */}
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-500">Data de postagem</label>
        <input
          type="datetime-local"
          value={item.scheduledDate}
          disabled={busy || terminal}
          onChange={(e) => onChange(item.id, { scheduledDate: e.target.value })}
          className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white outline-none focus:border-zinc-500 transition-colors disabled:opacity-50 [color-scheme:dark]"
        />
      </div>

      {/* Footer: status + post button */}
      <div className="flex items-center justify-between pt-1">
        <StatusBadge status={item.postStatus} error={item.postError} />
        {!terminal && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onPost(item.id)}
            className="rounded-xl bg-white px-4 py-2 text-xs font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {item.postStatus === "error" ? "Tentar novamente" : "Postar"}
          </button>
        )}
      </div>

      {/* Error detail */}
      {item.postStatus === "error" && item.postError && (
        <p className="rounded-lg bg-red-950/50 px-3 py-2 text-xs text-red-400">{item.postError}</p>
      )}
    </div>
  );
}

// ─── DropZone ─────────────────────────────────────────────────────────────────

function DropZone({
  loading,
  onFiles,
}: {
  loading: boolean;
  onFiles: (files: File[]) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onClick={() => inputRef.current?.click()}
      className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-8 py-12 transition-colors
        ${dragging
          ? "border-zinc-400 bg-zinc-800/60"
          : "border-zinc-700 bg-zinc-900/40 hover:border-zinc-600 hover:bg-zinc-900"
        }`}
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
        <p className="text-sm font-medium text-zinc-300">
          {loading ? "Extraindo arquivos..." : "Arraste vídeos ou uma pasta ZIP"}
        </p>
        <p className="mt-0.5 text-xs text-zinc-500">MP4, MOV, AVI, WEBM, MKV · ou .zip com vídeos</p>
      </div>
      {!loading && (
        <button
          type="button"
          className="rounded-lg bg-zinc-700 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-600"
        >
          Selecionar arquivos
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="video/*,.zip"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            onFiles(Array.from(e.target.files));
            e.target.value = "";
          }
        }}
      />
    </div>
  );
}

// ─── HashtagGroup types & helpers ────────────────────────────────────────────

type GroupId = "important" | "viral" | "custom";

type HashtagGroup = {
  id: GroupId;
  label: string;
  tags: string[];
  enabled: boolean;
  toggleable: boolean;
};

const DEFAULT_GROUPS: HashtagGroup[] = [
  {
    id: "important",
    label: "Principais",
    tags: ["fyp", "foryou", "foryoupage", "fy", "fypシ", "parati", "fup", "foryourpage", "viral", "tiktok"],
    enabled: true,
    toggleable: true,
  },
  {
    id: "viral",
    label: "Virais",
    tags: ["trending", "tiktokviral", "viralvideo", "explorepage", "trendingnow", "trendingvideo", "viralpost", "viraltiktok", "tiktoktrend", "explore"],
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

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${on ? "bg-emerald-500" : "bg-zinc-600"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${on ? "translate-x-4" : "translate-x-0"}`}
      />
    </button>
  );
}

// ─── GlobalHashtagPanel ───────────────────────────────────────────────────────

function GlobalHashtagPanel({
  groups,
  onGroupsChange,
}: {
  groups: HashtagGroup[];
  onGroupsChange: (next: HashtagGroup[]) => void;
}) {
  const toggle = (id: GroupId) => {
    onGroupsChange(groups.map((g) => (g.id === id ? { ...g, enabled: !g.enabled } : g)));
  };

  const setTags = (id: GroupId, tags: string[]) => {
    onGroupsChange(groups.map((g) => (g.id === id ? { ...g, tags } : g)));
  };

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
            {group.toggleable && (
              <Toggle on={group.enabled} onChange={() => toggle(group.id)} />
            )}
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
                <span
                  key={tag}
                  className="rounded-lg bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400"
                >
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

export default function TikTokImport() {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [groups, setGroups] = useState<HashtagGroup[]>(DEFAULT_GROUPS);
  const [loading, setLoading] = useState(false);

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
              items.push(makeItem(new File([blob], name, { type: `video/${ext}` }), activeTags));
            }
          } else if (isVideo(file.name)) {
            items.push(makeItem(file, activeTags));
          }
        }
        setVideos((prev) => [...prev, ...items]);
      } finally {
        setLoading(false);
      }
    },
    [groups]
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

    updateVideo(id, { postStatus: "uploading", postError: undefined });

    try {
      const fd = new FormData();
      fd.append("video", item.file, item.file.name);
      fd.append("title", item.title);
      fd.append("hashtags", JSON.stringify(item.hashtags));
      if (item.scheduledDate) fd.append("scheduledDate", item.scheduledDate);

      const res = await fetch("/api/tiktok/post", { method: "POST", body: fd });
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

  // Poll status for any in-flight jobs every 3 s
  useEffect(() => {
    const inFlight = videos.filter(
      (v) => v.jobId && v.postStatus !== "done" && v.postStatus !== "error"
    );
    if (!inFlight.length) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/tiktok/status");
        const { jobs } = await res.json() as { jobs: Record<string, { status: PostStatus; error?: string }> };
        setVideos((prev) =>
          prev.map((v) => {
            if (!v.jobId) return v;
            const job = jobs[v.jobId];
            if (!job) return v;
            return { ...v, postStatus: job.status, postError: job.error };
          })
        );
      } catch { /* ignore transient errors */ }
    }, 3_000);

    return () => clearInterval(interval);
  }, [videos]);

  return (
    <div className="flex flex-col gap-6">
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
            <button
              type="button"
              onClick={() => {
                videos.forEach((v) => URL.revokeObjectURL(v.url));
                setVideos([]);
              }}
              className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
            >
              Limpar todos
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {videos.map((item) => (
              <VideoCard
                key={item.id}
                item={item}
                onChange={updateVideo}
                onRemove={removeVideo}
                onPost={handlePost}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
