import { NextResponse } from "next/server";
import { createScenario, getScenarios } from "@/lib/store";

export async function GET() {
  const scenarios = await getScenarios();
  return NextResponse.json(scenarios);
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    name?: string;
    category?: string;
    description?: string;
  };

  if (!body.name || !body.category || !body.description) {
    return new NextResponse("name, category and description are required", { status: 400 });
  }

  const scenario = await createScenario({
    name: body.name,
    category: body.category,
    description: body.description
  });

  return NextResponse.json(scenario, { status: 201 });
}
