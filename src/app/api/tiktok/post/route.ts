import { NextRequest, NextResponse } from "next/server";
import os from "os";
import path from "path";
import fs from "fs";
import { enqueue, appendLog } from "@/lib/queue";
import { postToTikTok } from "@/lib/tiktok-poster";

const TMP_DIR = path.join(os.tmpdir(), "tiktok-crawler");

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const file = formData.get("video") as File | null;
    const title = (formData.get("title") as string) ?? "";
    const description = (formData.get("description") as string) || undefined;
    const comment = (formData.get("comment") as string) || undefined;
    const hashtags = JSON.parse((formData.get("hashtags") as string) ?? "[]") as string[];
    const scheduledDate = (formData.get("scheduledDate") as string) || undefined;
    const headless = formData.get("showBrowser") !== "true";

    if (!file) {
      return NextResponse.json({ error: "No video file provided" }, { status: 400 });
    }

    // Save video to temp dir
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

    // Purge leftover files from crashed/cancelled jobs (older than 1 hour).
    try {
      const cutoff = Date.now() - 60 * 60 * 1_000;
      for (const f of fs.readdirSync(TMP_DIR)) {
        const fp = path.join(TMP_DIR, f);
        try {
          if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
        } catch { /* ignore per-file errors */ }
      }
    } catch { /* ignore — cleanup is best-effort */ }

    const jobId = crypto.randomUUID();
    const ext = file.name.slice(file.name.lastIndexOf(".")) || ".mp4";
    const filePath = path.join(TMP_DIR, `${jobId}${ext}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    try {
      fs.writeFileSync(filePath, buffer);
    } catch (writeErr: unknown) {
      const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
      if (msg.includes("ENOSPC") || msg.includes("no space")) {
        throw new Error(`Disco sem espaço ao salvar o vídeo temporário (${TMP_DIR}). Libere espaço e tente novamente.`);
      }
      throw writeErr;
    }

    // Add to queue — runs concurrently up to 10, rest waits in FIFO order
    enqueue(jobId, title, () =>
      postToTikTok({ filePath, title, description, comment, hashtags, scheduledDate, headless, log: (msg) => appendLog(jobId, msg) })
    );

    return NextResponse.json({ jobId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
