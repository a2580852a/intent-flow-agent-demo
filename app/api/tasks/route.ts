import { NextResponse } from "next/server";
import { createTask, getTasks } from "@/lib/store";

export async function GET() {
  const tasks = await getTasks();
  return NextResponse.json(tasks);
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    request?: string;
    scenarioId?: string;
  };

  if (!body.request?.trim()) {
    return new NextResponse("request is required", { status: 400 });
  }

  const task = await createTask(body.request.trim(), body.scenarioId);
  return NextResponse.json(task, { status: 201 });
}
