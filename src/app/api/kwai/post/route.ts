import { NextRequest, NextResponse } from "next/server";
import os from "os";
import path from "path";
import fs from "fs";
import { kwaiEnqueue, kwaiAppendLog } from "@/lib/kwai-queue";
import { postToKwaiAdb } from "@/lib/kwai-adb-poster";

const TMP_DIR = path.join(os.tmpdir(), "kwai-crawler");

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const file = formData.get("video") as File | null;
    const title = (formData.get("title") as string) ?? "";
    const comment = (formData.get("comment") as string) || undefined;
    const hashtags = JSON.parse((formData.get("hashtags") as string) ?? "[]") as string[];

    if (!file) {
      return NextResponse.json({ error: "Nenhum arquivo de vídeo enviado" }, { status: 400 });
    }

    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

    const jobId = crypto.randomUUID();
    const ext = file.name.slice(file.name.lastIndexOf(".")) || ".mp4";
    const filePath = path.join(TMP_DIR, `${jobId}${ext}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    kwaiEnqueue(jobId, title, () =>
      postToKwaiAdb({
        filePath,
        title,
        comment,
        hashtags,
        log: (msg) => kwaiAppendLog(jobId, msg),
      })
    );

    return NextResponse.json({ jobId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
