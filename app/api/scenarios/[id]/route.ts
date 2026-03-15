import { NextResponse } from "next/server";
import { updateScenario } from "@/lib/store";
import type { Scenario } from "@/lib/types";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as Partial<Omit<Scenario, "id" | "updatedAt">>;
    const scenario = await updateScenario(id, body);
    return NextResponse.json(scenario);
  } catch (error) {
    return new NextResponse(error instanceof Error ? error.message : "Unable to update scenario", {
      status: 400
    });
  }
}
