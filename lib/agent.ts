import { randomUUID } from "node:crypto";
import { extractFeedbackPatchWithLLM, isMoonshotEnabled, planTaskWithLLM } from "@/lib/llm";
import type {
  BackendCheck,
  ExtractionResult,
  FeedbackEntry,
  LinkedContentFailure,
  LinkedContentRead,
  Scenario,
  ScenarioField,
  Task,
  TaskStatus,
  UserFeedbackInput
} from "@/lib/types";

function nowIso() {
  return new Date().toISOString();
}

function normalize(input: string) {
  return input.trim().toLowerCase();
}

function roundConfidence(score: number) {
  return Math.max(0.35, Math.min(0.99, Math.round(score * 100) / 100));
}

function toFieldVariants(field: ScenarioField) {
  return [field.label, field.id, ...field.extractionHints].filter(Boolean);
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function padDatePart(input: string) {
  return input.length === 1 ? `0${input}` : input;
}

function normalizeDate(raw: string) {
  const cleaned = raw.replace(/[./]/g, "-");
  const match = cleaned.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) {
    return raw;
  }

  const [, year, month, day] = match;
  return `${year}-${padDatePart(month)}-${padDatePart(day)}`;
}

function detectWithPattern(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  return match?.[1]?.trim();
}

function extractUrlsFromText(text: string) {
  const matched = text.match(/https?:\/\/[^\s<>"'`，。；;）)]+/g) ?? [];
  return Array.from(
    new Set(
      matched
        .map((item) => item.trim().replace(/[.,;:!?，。；：！？）)]$/, ""))
        .filter(Boolean)
    )
  );
}

function isPublicHttpUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) {
      return false;
    }

    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return false;
    }

    if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function decodeHtmlEntities(input: string) {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

function htmlToText(input: string) {
  return decodeHtmlEntities(
    input
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

async function fetchTextWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "text/html, text/plain, application/json;q=0.9"
      },
      signal: controller.signal,
      cache: "no-store"
    });

    if (!response.ok) {
      return {
        text: "",
        reason: `HTTP ${response.status}`
      };
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const raw = (await response.text()).slice(0, 120_000);

    if (contentType.includes("text/html")) {
      return {
        text: htmlToText(raw),
        reason: ""
      };
    }

    return {
      text: raw.replace(/\s+/g, " ").trim(),
      reason: ""
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { text: "", reason: "请求超时" };
    }
    return { text: "", reason: "读取失败" };
  } finally {
    clearTimeout(timeout);
  }
}

async function enrichRequestWithLinkedContent(request: string) {
  const detectedUrls = extractUrlsFromText(request).slice(0, 3);
  if (detectedUrls.length === 0) {
    return {
      enrichedRequest: request,
      linkedContent: {
        detectedUrls: [],
        successfulReads: [] as LinkedContentRead[],
        failedReads: [] as LinkedContentFailure[]
      }
    };
  }

  const segments: string[] = [];
  const successfulReads: LinkedContentRead[] = [];
  const failedReads: LinkedContentFailure[] = [];

  for (const url of detectedUrls) {
    if (!isPublicHttpUrl(url)) {
      failedReads.push({ url, reason: "仅支持公网 HTTP/HTTPS 链接" });
      continue;
    }

    const { text, reason } = await fetchTextWithTimeout(url, 6000);
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (!cleaned) {
      failedReads.push({ url, reason: reason || "页面为空或无法提取正文" });
      continue;
    }

    successfulReads.push({
      url,
      summary: cleaned.slice(0, 180)
    });
    segments.push(`来源链接: ${url}\n内容摘要: ${cleaned.slice(0, 3000)}`);
  }

  if (segments.length === 0) {
    return {
      enrichedRequest: request,
      linkedContent: {
        detectedUrls,
        successfulReads,
        failedReads
      }
    };
  }

  return {
    enrichedRequest: `${request}\n\n[外部链接补充信息]\n${segments.join("\n\n")}`,
    linkedContent: {
      detectedUrls,
      successfulReads,
      failedReads
    }
  };
}

function normalizeFieldValue(value: string | undefined, field: ScenarioField) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return "";
  }

  if (field.type === "date" || field.id.toLowerCase().includes("date")) {
    return normalizeDate(trimmed);
  }

  if (field.type === "id" || field.id.toLowerCase().includes("id")) {
    return trimmed.toUpperCase();
  }

  return trimmed;
}

function cleanExtractedValue(value: string) {
  return value
    .replace(/^(改成|改为|调整为|设置为|是|为)/, "")
    .replace(/^[:：\s]+/, "")
    .trim();
}

function extractFieldValue(text: string, field: ScenarioField) {
  const source = text.trim();
  const lower = source.toLowerCase();
  const variants = toFieldVariants(field);

  if (field.options?.length) {
    const matchedOption = field.options.find((option) => lower.includes(option.toLowerCase()));
    if (matchedOption) {
      return matchedOption;
    }
  }

  if (field.type === "email" || field.id.toLowerCase().includes("email")) {
    const emailMatch = source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (emailMatch) {
      return emailMatch[0];
    }
  }

  if (field.type === "date" || field.id.toLowerCase().includes("date")) {
    const dateMatch = source.match(/\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b/);
    if (dateMatch) {
      return normalizeDate(dateMatch[0]);
    }
  }

  if (field.type === "id" || field.id.toLowerCase().includes("id")) {
    const idMatch = source.match(/\b\d{17}[\dXx]\b/);
    if (idMatch) {
      return idMatch[0].toUpperCase();
    }
  }

  for (const variant of variants) {
    const labelledValue =
      detectWithPattern(source, new RegExp(`${escapeRegExp(variant)}(?:是|为|:|：)?\\s*([^,，。；;\\n]+)`, "i")) ??
      detectWithPattern(source, new RegExp(`${escapeRegExp(variant)}\\s*=\\s*([^,，。；;\\n]+)`, "i"));

    if (labelledValue) {
      const cleanedValue = cleanExtractedValue(labelledValue);
      return field.type === "date" ? normalizeDate(cleanedValue) : cleanedValue;
    }
  }

  if (field.id === "employeeName" || field.id === "applicantName") {
    const nameMatch = source.match(/(?:姓名|申请人|员工|候选人)(?:是|为|:|：)?\s*([\u4e00-\u9fa5A-Za-z\s]{2,20})/);
    if (nameMatch) {
      return nameMatch[1].trim();
    }
  }

  if (field.id === "days") {
    const dayMatch = source.match(/(\d+)\s*(?:天|day|days)/i);
    if (dayMatch) {
      return dayMatch[1];
    }
  }

  if (field.id === "budget") {
    const budgetMatch = source.match(/(\d{3,6})\s*(?:元|人民币|rmb|cny)?/i);
    if (budgetMatch) {
      return budgetMatch[1];
    }
  }

  return "";
}

function computeCompletion(schemaDraft: Record<string, string>, fields: ScenarioField[]) {
  const filledCount = fields.filter((field) => schemaDraft[field.id]).length;
  return fields.length === 0 ? 100 : Math.round((filledCount / fields.length) * 100);
}

function computeMissing(schemaDraft: Record<string, string>, fields: ScenarioField[]) {
  return fields.filter((field) => field.required && !schemaDraft[field.id]).map((field) => field.id);
}

export function inferScenario(request: string, scenarios: Scenario[], preferredScenarioId?: string) {
  if (preferredScenarioId) {
    const selected = scenarios.find((scenario) => scenario.id === preferredScenarioId);
    if (selected) {
      return {
        scenario: selected,
        confidence: 0.99,
        matchedKeywords: ["manual-selection"],
        reasoning: "用户在工作台中明确选择了业务场景，直接使用该 Schema。"
      };
    }
  }

  const normalizedRequest = normalize(request);

  const ranked = scenarios
    .map((scenario) => {
      const matchedKeywords = scenario.keywords.filter((keyword) => normalizedRequest.includes(keyword.toLowerCase()));
      const nameBoost = normalizedRequest.includes(scenario.name.toLowerCase()) ? 1 : 0;
      const categoryBoost = normalizedRequest.includes(scenario.category.toLowerCase()) ? 1 : 0;
      const score = matchedKeywords.length * 0.25 + nameBoost * 0.15 + categoryBoost * 0.1;

      return {
        scenario,
        matchedKeywords,
        score
      };
    })
    .sort((left, right) => right.score - left.score);

  const best = ranked[0] ?? { scenario: scenarios[0], matchedKeywords: [], score: 0 };

  return {
    scenario: best.scenario,
    confidence: roundConfidence(0.45 + best.score),
    matchedKeywords: best.matchedKeywords,
    reasoning:
      best.matchedKeywords.length > 0
        ? `检测到关键词 ${best.matchedKeywords.join(" / ")}，路由到 ${best.scenario.name}。`
        : `未命中强关键词，按默认优先级降级到 ${best.scenario.name}，等待用户确认。`
  };
}

export function extractSchemaDraft(text: string, scenario: Scenario): ExtractionResult {
  const schemaDraft = Object.fromEntries(
    scenario.schema.map((field) => [field.id, extractFieldValue(text, field)])
  ) as Record<string, string>;

  const missingFields = computeMissing(schemaDraft, scenario.schema);

  return {
    schemaDraft,
    missingFields,
    completionRate: computeCompletion(schemaDraft, scenario.schema)
  };
}

function buildExtractionFromDraft(schemaDraft: Record<string, string>, scenario: Scenario): ExtractionResult {
  const normalizedDraft = normalizeDraftForScenario(schemaDraft, scenario);

  return {
    schemaDraft: normalizedDraft,
    missingFields: computeMissing(normalizedDraft, scenario.schema),
    completionRate: computeCompletion(normalizedDraft, scenario.schema)
  };
}

function normalizeDraftForScenario(schemaDraft: Record<string, string>, scenario: Scenario) {
  const normalizedDraft = Object.fromEntries(
    scenario.schema.map((field) => [field.id, normalizeFieldValue(schemaDraft[field.id], field)])
  ) as Record<string, string>;

  return normalizedDraft;
}

function normalizePartialDraft(
  partialDraft: Record<string, string>,
  scenario: Scenario
) {
  return Object.fromEntries(
    Object.keys(partialDraft)
      .filter((fieldId) => scenario.schema.some((field) => field.id === fieldId))
      .map((fieldId) => {
        const field = scenario.schema.find((item) => item.id === fieldId);
        return [fieldId, field ? normalizeFieldValue(partialDraft[fieldId], field) : partialDraft[fieldId]];
      })
  ) as Record<string, string>;
}

function mergeNonEmptyDrafts(
  baseDraft: Record<string, string>,
  overlayDraft: Record<string, string>,
  scenario: Scenario
) {
  return Object.fromEntries(
    scenario.schema.map((field) => {
      const overlayValue = overlayDraft[field.id]?.trim();
      return [field.id, overlayValue || baseDraft[field.id] || ""];
    })
  ) as Record<string, string>;
}

function describePatchedFields(updatedIds: string[], scenario: Scenario) {
  const labels = updatedIds
    .map((fieldId) => scenario.schema.find((field) => field.id === fieldId)?.label)
    .filter(Boolean) as string[];

  return labels.length > 0 ? labels.join("、") : "未识别到具体字段";
}

function createFeedbackEntry(source: "user" | "backend", status: FeedbackEntry["status"], message: string): FeedbackEntry {
  return {
    id: randomUUID(),
    source,
    status,
    message,
    createdAt: nowIso()
  };
}

function evaluateEntrySceneChecks(task: Task, checks: BackendCheck[]) {
  const issues: FeedbackEntry[] = [];
  const idCard = task.schemaFinal.idCard ?? "";
  const startDate = task.schemaFinal.startDate ?? "";
  const department = task.schemaFinal.department ?? "";
  const location = task.schemaFinal.location ?? "";

  const duplicateCheck = checks.find((check) => check.id === "identity_uniqueness");
  if (duplicateCheck && idCard.endsWith("0")) {
    issues.push(
      createFeedbackEntry(
        "backend",
        "needs_attention",
        `${duplicateCheck.label}未通过：证件号尾号命中了重复样本库，请人工复核或改用新员工证件号。`
      )
    );
  }

  const permissionCheck = checks.find((check) => check.id === "permission_scope");
  if (permissionCheck && department === "财务中心" && location && location !== "上海") {
    issues.push(
      createFeedbackEntry(
        "backend",
        "needs_attention",
        `${permissionCheck.label}预警：财务中心默认在上海开通高敏权限，当前办公地需要额外审批。`
      )
    );
  }

  const seatCheck = checks.find((check) => check.id === "seat_inventory");
  if (seatCheck && startDate && startDate < "2026-03-20") {
    issues.push(
      createFeedbackEntry(
        "backend",
        "needs_attention",
        `${seatCheck.label}提示：目标日期前的工位已接近满载，建议延后入职时间或切换办公地。`
      )
    );
  }

  return issues;
}

function evaluateLeaveSceneChecks(task: Task, checks: BackendCheck[]) {
  const issues: FeedbackEntry[] = [];
  const days = Number(task.schemaFinal.days ?? "0");

  const quotaCheck = checks.find((check) => check.id === "quota_check");
  if (quotaCheck && days > 10) {
    issues.push(
      createFeedbackEntry(
        "backend",
        "needs_attention",
        `${quotaCheck.label}未通过：超过 10 天的请假申请需要拆分为多段或走特殊审批。`
      )
    );
  }

  return issues;
}

function evaluateProcurementSceneChecks(task: Task, checks: BackendCheck[]) {
  const issues: FeedbackEntry[] = [];
  const budget = Number(task.schemaFinal.budget ?? "0");

  const budgetCheck = checks.find((check) => check.id === "budget_limit");
  if (budgetCheck && budget > 50000) {
    issues.push(
      createFeedbackEntry(
        "backend",
        "needs_attention",
        `${budgetCheck.label}未通过：超过 50,000 元的采购需升级到区域负责人审批。`
      )
    );
  }

  const vendorCheck = checks.find((check) => check.id === "vendor_whitelist");
  if (vendorCheck && !task.schemaFinal.vendorName) {
    issues.push(
      createFeedbackEntry(
        "backend",
        "needs_attention",
        `${vendorCheck.label}未通过：缺少供应商信息，无法命中白名单。`
      )
    );
  }

  return issues;
}

export async function createTaskRecord(request: string, scenarios: Scenario[], preferredScenarioId?: string): Promise<Task> {
  const { enrichedRequest, linkedContent } = await enrichRequestWithLinkedContent(request);
  const heuristicPlanning = inferScenario(enrichedRequest, scenarios, preferredScenarioId);
  let scenario = heuristicPlanning.scenario;
  let confidence = heuristicPlanning.confidence;
  let matchedKeywords = heuristicPlanning.matchedKeywords;
  let reasoning = heuristicPlanning.reasoning;
  let extraction = extractSchemaDraft(enrichedRequest, scenario);

  if (isMoonshotEnabled()) {
    try {
      const llmResult = await planTaskWithLLM({ request: enrichedRequest, scenarios, preferredScenarioId });
      const llmScenario = scenarios.find((item) => item.id === llmResult?.scenarioId);

      if (llmScenario) {
        scenario = llmScenario;
        const heuristicExtraction = extractSchemaDraft(enrichedRequest, llmScenario);
        const llmDraft = llmResult?.schemaDraft ?? {};
        const mergedDraft = mergeNonEmptyDrafts(heuristicExtraction.schemaDraft, llmDraft, llmScenario);
        extraction = buildExtractionFromDraft(mergedDraft, llmScenario);
      }

      confidence = typeof llmResult?.confidence === "number" ? llmResult.confidence : confidence;
      matchedKeywords = llmResult?.matchedKeywords?.length ? llmResult.matchedKeywords : matchedKeywords;
      reasoning = llmResult?.reasoning || reasoning;
    } catch {
      extraction = extractSchemaDraft(enrichedRequest, scenario);
    }
  }

  if (linkedContent.detectedUrls.length > 0) {
    reasoning = `${reasoning} PRD链接读取：成功 ${linkedContent.successfulReads.length}，失败 ${linkedContent.failedReads.length}。`;
  }

  const createdAt = nowIso();

  return {
    id: randomUUID(),
    request,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    status: "awaiting_user",
    planning: {
      confidence,
      matchedKeywords,
      reasoning
    },
    retrieval: {
      schemaVersion: scenario.schemaVersion,
      knowledgeRefs: scenario.knowledgeRefs.map((reference) => reference.title),
      retrievedAt: createdAt
    },
    extraction,
    userFeedback: [],
    backendFeedback: [],
    schemaFinal: extraction.schemaDraft,
    linkedContent,
    createdAt,
    updatedAt: createdAt
  };
}

export async function applyUserFeedback(task: Task, scenario: Scenario, input: UserFeedbackInput) {
  const note = input.note?.trim() ?? "";
  const action = input.action;
  const currentDraft = normalizeDraftForScenario(task.schemaFinal, scenario);
  const explicitDraft = input.draft ? normalizeDraftForScenario(input.draft, scenario) : null;

  const explicitChangedFields = explicitDraft
    ? scenario.schema
        .map((field) => field.id)
        .filter((fieldId) => explicitDraft[fieldId] !== currentDraft[fieldId])
    : [];

  const heuristicPatch = note ? normalizePartialDraft(extractSchemaDraft(note, scenario).schemaDraft, scenario) : {};
  let notePatch = heuristicPatch;

  if (isMoonshotEnabled() && note) {
    try {
      const llmPatch = (await extractFeedbackPatchWithLLM({
        note,
        scenario,
        currentDraft
      }))?.patch;

      if (llmPatch) {
        notePatch = {
          ...heuristicPatch,
          ...normalizePartialDraft(llmPatch, scenario)
        };
      }
    } catch {
      notePatch = heuristicPatch;
    }
  }

  const explicitChangedFieldSet = new Set(explicitChangedFields);
  const noteApplicablePatch = Object.fromEntries(
    Object.entries(notePatch).filter(([fieldId, value]) => {
      if (explicitChangedFieldSet.has(fieldId)) {
        return false;
      }

      return value !== currentDraft[fieldId];
    })
  ) as Record<string, string>;

  const mergedDraft = explicitDraft
    ? {
        ...currentDraft,
        ...noteApplicablePatch,
        ...explicitDraft
      }
    : {
        ...currentDraft,
        ...noteApplicablePatch
      };

  const extraction = buildExtractionFromDraft(mergedDraft, scenario);
  const updatedFields = Array.from(new Set([...explicitChangedFields, ...Object.keys(noteApplicablePatch)]));
  const missingFields = extraction.missingFields;

  const nextStatus: TaskStatus = action === "confirm" && missingFields.length === 0 ? "awaiting_backend" : "awaiting_user";

  const feedbackMessage =
    action === "confirm"
      ? missingFields.length === 0
        ? "用户确认结构化结果无误，任务进入后端校验阶段。"
        : `用户尝试确认，但仍缺失字段：${describePatchedFields(missingFields, scenario)}。`
      : updatedFields.length > 0
        ? `用户提交表格修订，系统更新字段：${describePatchedFields(updatedFields, scenario)}。`
        : "用户提交表格修订，但未发现字段变化。";

  const feedbackStatus: FeedbackEntry["status"] =
    action === "confirm" && missingFields.length === 0 ? "accepted" : "needs_attention";

  return {
    ...task,
    status: nextStatus,
    extraction,
    schemaFinal: extraction.schemaDraft,
    userFeedback: [createFeedbackEntry("user", feedbackStatus, feedbackMessage), ...task.userFeedback],
    updatedAt: nowIso()
  };
}

export function applyBackendValidation(task: Task, scenario: Scenario) {
  const issues =
    scenario.id === "entry_scene"
      ? evaluateEntrySceneChecks(task, scenario.backendChecks)
      : scenario.id === "leave_scene"
        ? evaluateLeaveSceneChecks(task, scenario.backendChecks)
        : evaluateProcurementSceneChecks(task, scenario.backendChecks);

  if (issues.length === 0) {
    return {
      ...task,
      status: "completed" as TaskStatus,
      backendFeedback: [
        createFeedbackEntry("backend", "passed", "后端校验通过：字段完整、规则合法，可直接提交业务系统。"),
        ...task.backendFeedback
      ],
      updatedAt: nowIso()
    };
  }

  return {
    ...task,
    status: "awaiting_user" as TaskStatus,
    backendFeedback: [...issues, ...task.backendFeedback],
    updatedAt: nowIso()
  };
}
