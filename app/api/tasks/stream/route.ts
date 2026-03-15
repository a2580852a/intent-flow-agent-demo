import { NextResponse } from "next/server";
import { extractSchemaDraft, inferScenario } from "@/lib/agent";
import { createTask, getScenarios } from "@/lib/store";

type StreamEvent =
  | { type: "token"; text: string }
  | { type: "stage"; stage: "planning" | "retrieval" | "extraction"; detail: string }
  | { type: "task"; task: Awaited<ReturnType<typeof createTask>> }
  | { type: "error"; message: string }
  | { type: "done" };

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function streamText(send: (event: StreamEvent) => void, text: string, chunkSize = 14) {
  for (let index = 0; index < text.length; index += chunkSize) {
    const chunk = text.slice(index, index + chunkSize);
    send({ type: "token", text: chunk });
    await sleep(35);
  }
  send({ type: "token", text: "\n" });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    request?: string;
    scenarioId?: string;
  };

  const rawRequest = body.request?.trim();
  if (!rawRequest) {
    return new NextResponse("request is required", { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      void (async () => {
        try {
          const scenarios = await getScenarios();
          const planning = inferScenario(rawRequest, scenarios, body.scenarioId);
          const extraction = extractSchemaDraft(rawRequest, planning.scenario);

          send({
            type: "stage",
            stage: "planning",
            detail: `路由到 ${planning.scenario.name}，置信度 ${Math.round(planning.confidence * 100)}%`
          });
          await streamText(
            send,
            `收到你的请求，正在做意图识别与场景路由。当前命中场景：${planning.scenario.name}。`
          );

          send({
            type: "stage",
            stage: "retrieval",
            detail: `匹配到 ${planning.scenario.schema.length} 个字段，知识引用 ${planning.scenario.knowledgeRefs.length} 条`
          });
          await streamText(
            send,
            `已加载该场景的 Schema 与知识片段，准备抽取结构化字段。`
          );

          send({
            type: "stage",
            stage: "extraction",
            detail: `字段完整度 ${extraction.completionRate}%，缺失 ${extraction.missingFields.length} 项`
          });
          await streamText(
            send,
            `抽取完成：当前字段完整度 ${extraction.completionRate}% ，缺失 ${extraction.missingFields.length} 项。现在写入任务并进入可编辑状态。`
          );

          const task = await createTask(rawRequest, body.scenarioId);
          send({ type: "task", task });
          await streamText(send, `任务已创建，你可以在右侧 Step 2 继续修订并提交后端校验。`);
          send({ type: "done" });
        } catch (error) {
          send({
            type: "error",
            message: error instanceof Error ? error.message : "stream failed"
          });
        } finally {
          controller.close();
        }
      })();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
