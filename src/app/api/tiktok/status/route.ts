import { NextResponse } from "next/server";
import { getAllJobs, getStats } from "@/lib/queue";

export async function GET() {
  return NextResponse.json({
    jobs: getAllJobs(),
    stats: getStats(),
  });
}
