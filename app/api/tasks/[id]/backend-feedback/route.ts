import { NextResponse } from "next/server";
import { triggerBackendValidation } from "@/lib/store";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const task = await triggerBackendValidation(id);
    return NextResponse.json(task);
  } catch (error) {
    return new NextResponse(error instanceof Error ? error.message : "Unable to run backend validation", {
      status: 400
    });
  }
}
