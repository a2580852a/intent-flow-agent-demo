import OpenAI from "openai";
import type { Scenario } from "@/lib/types";

interface PlanningExtractionResult {
  scenarioId?: string;
  confidence?: number;
  reasoning?: string;
  matchedKeywords?: string[];
  schemaDraft?: Record<string, string>;
}

interface FeedbackPatchResult {
  patch?: Record<string, string>;
}

const DEFAULT_BASE_URL = "https://api.moonshot.cn/v1";
const DEFAULT_MODEL = "kimi-k2-turbo-preview";

function getClient() {
  if (!process.env.MOONSHOT_API_KEY) {
    return null;
  }

  return new OpenAI({
    apiKey: process.env.MOONSHOT_API_KEY,
    baseURL: process.env.MOONSHOT_BASE_URL || DEFAULT_BASE_URL
  });
}

function stripCodeFence(input: string) {
  return input.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

function extractJsonPayload(input: string) {
  const stripped = stripCodeFence(input);
  const objectStart = stripped.indexOf("{");
  const objectEnd = stripped.lastIndexOf("}");

  if (objectStart === -1 || objectEnd === -1 || objectEnd <= objectStart) {
    throw new Error("Model did not return JSON");
  }

  return stripped.slice(objectStart, objectEnd + 1);
}

function compactScenarioPayload(scenarios: Scenario[]) {
  return scenarios.map((scenario) => ({
    id: scenario.id,
    name: scenario.name,
    category: scenario.category,
    description: scenario.description,
    keywords: scenario.keywords,
    schema: scenario.schema.map((field) => ({
      id: field.id,
      label: field.label,
      type: field.type,
      required: field.required,
      description: field.description,
      hints: field.extractionHints,
      options: field.options ?? []
    }))
  }));
}

export function isMoonshotEnabled() {
  return Boolean(process.env.MOONSHOT_API_KEY);
}

export async function planTaskWithLLM(input: {
  request: string;
  scenarios: Scenario[];
  preferredScenarioId?: string;
}) {
  const client = getClient();
  if (!client) {
    return null;
  }

  const completion = await client.chat.completions.create({
    model: process.env.MOONSHOT_MODEL || DEFAULT_MODEL,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "你是企业级智能任务 Agent 的规划与结构化抽取引擎。你必须只输出 JSON，不要输出解释、不要使用 Markdown。JSON 字段必须包含：scenarioId, confidence, reasoning, matchedKeywords, schemaDraft。"
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            task: "route_and_extract",
            preferredScenarioId: input.preferredScenarioId || null,
            request: input.request,
            scenarios: compactScenarioPayload(input.scenarios),
            instructions: [
              "先根据 request 判断最匹配的场景。如果用户显式给了 preferredScenarioId，优先使用它。",
              "然后仅针对选中场景输出 schemaDraft，键名必须严格使用 schema 中的 field.id。",
              "没有把握的字段请返回空字符串。",
              "confidence 在 0 到 1 之间。matchedKeywords 返回命中的关键词数组。"
            ]
          },
          null,
          2
        )
      }
    ]
  });

  const content = completion.choices[0]?.message?.content ?? "";
  return JSON.parse(extractJsonPayload(content)) as PlanningExtractionResult;
}

export async function extractFeedbackPatchWithLLM(input: {
  note: string;
  scenario: Scenario;
  currentDraft: Record<string, string>;
}) {
  const client = getClient();
  if (!client || !input.note.trim()) {
    return null;
  }

  const completion = await client.chat.completions.create({
    model: process.env.MOONSHOT_MODEL || DEFAULT_MODEL,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "你是企业级任务 Agent 的字段修订引擎。你必须只输出 JSON，不要输出解释。JSON 字段只允许包含 patch。patch 中只返回用户明确修改过的字段，键名必须严格使用 field.id。"
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            task: "extract_feedback_patch",
            note: input.note,
            currentDraft: input.currentDraft,
            scenario: {
              id: input.scenario.id,
              name: input.scenario.name,
              schema: input.scenario.schema.map((field) => ({
                id: field.id,
                label: field.label,
                type: field.type,
                required: field.required,
                hints: field.extractionHints,
                options: field.options ?? []
              }))
            },
            instructions: [
              "如果用户只是确认无误，没有明确修改字段，patch 返回空对象。",
              "不要重复输出未改动字段。",
              "如果用户要求删除值，可以把该字段返回空字符串。"
            ]
          },
          null,
          2
        )
      }
    ]
  });

  const content = completion.choices[0]?.message?.content ?? "";
  return JSON.parse(extractJsonPayload(content)) as FeedbackPatchResult;
}
