import { NextResponse } from "next/server";
import { getTask } from "@/lib/store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const task = await getTask(id);

  if (!task) {
    return new NextResponse("Task not found", { status: 404 });
  }

  return NextResponse.json(task);
}
