import { NextResponse } from "next/server";
import { kwaiGetAllJobs, kwaiGetStats } from "@/lib/kwai-queue";

export async function GET() {
  return NextResponse.json({
    jobs: kwaiGetAllJobs(),
    stats: kwaiGetStats(),
  });
}
