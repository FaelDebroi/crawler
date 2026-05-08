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
    const hashtags = JSON.parse((formData.get("hashtags") as string) ?? "[]") as string[];
    const scheduledDate = (formData.get("scheduledDate") as string) || undefined;
    const headless = formData.get("showBrowser") !== "true";

    if (!file) {
      return NextResponse.json({ error: "No video file provided" }, { status: 400 });
    }

    const email = process.env.TIKTOK_EMAIL ?? "";
    const password = process.env.TIKTOK_PASSWORD ?? "";
    if (!email || !password) {
      return NextResponse.json({ error: "TIKTOK_EMAIL / TIKTOK_PASSWORD not set in env" }, { status: 500 });
    }

    // Save video to temp dir
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

    const jobId = crypto.randomUUID();
    const ext = file.name.slice(file.name.lastIndexOf(".")) || ".mp4";
    const filePath = path.join(TMP_DIR, `${jobId}${ext}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    // Add to queue — runs concurrently up to 10, rest waits in FIFO order
    enqueue(jobId, title, () =>
      postToTikTok({ filePath, title, hashtags, scheduledDate, email, password, headless, log: (msg) => appendLog(jobId, msg) })
    );

    return NextResponse.json({ jobId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
