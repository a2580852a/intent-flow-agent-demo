import { promises as fs } from "node:fs";
import path from "node:path";
import scenariosSeed from "@/data/scenarios.json";
import tasksSeed from "@/data/tasks.json";
import { applyBackendValidation, applyUserFeedback, createTaskRecord } from "@/lib/agent";
import type { DashboardSnapshot, Scenario, Task, UserFeedbackInput } from "@/lib/types";

const dataDir = path.join(process.cwd(), "data");

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function ensureDataFile<T>(fileName: string, fallback: T) {
  const target = path.join(dataDir, fileName);
  await fs.mkdir(dataDir, { recursive: true });

  try {
    await fs.access(target);
  } catch {
    await fs.writeFile(target, JSON.stringify(fallback, null, 2), "utf8");
  }
}

async function readJson<T>(fileName: string, fallback: T): Promise<T> {
  const target = path.join(dataDir, fileName);
  await ensureDataFile(fileName, fallback);
  const raw = await fs.readFile(target, "utf8");
  return JSON.parse(raw) as T;
}

async function writeJson<T>(fileName: string, value: T) {
  const target = path.join(dataDir, fileName);
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(target, JSON.stringify(value, null, 2), "utf8");
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function sanitizeKeywords(input: string[]) {
  return Array.from(new Set(input.map((item) => item.trim()).filter(Boolean)));
}

export async function getScenarios() {
  return readJson<Scenario[]>("scenarios.json", clone(scenariosSeed as unknown as Scenario[]));
}

export async function getTasks() {
  const tasks = await readJson<Task[]>("tasks.json", clone(tasksSeed as unknown as Task[]));
  return tasks.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export async function getTask(taskId: string) {
  const tasks = await getTasks();
  return tasks.find((task) => task.id === taskId) ?? null;
}

export async function createTask(request: string, preferredScenarioId?: string) {
  const scenarios = await getScenarios();
  const tasks = await getTasks();
  const task = await createTaskRecord(request, scenarios, preferredScenarioId);
  await writeJson("tasks.json", [task, ...tasks]);
  return task;
}

export async function createScenario(input: { name: string; category: string; description: string }) {
  const scenarios = await getScenarios();
  const timestamp = new Date().toISOString();
  const scenarioId = `${slugify(input.name)}_scene`;

  const scenario: Scenario = {
    id: scenarioId,
    name: input.name,
    category: input.category,
    description: input.description,
    keywords: sanitizeKeywords([input.name, input.category]),
    schemaVersion: "v1.0.0",
    schema: [
      {
        id: "requestTitle",
        label: "申请主题",
        type: "text",
        required: true,
        description: "当前场景的标题或摘要。",
        extractionHints: ["主题", "标题", "事项"],
        placeholder: "例如：新办公室门禁开通"
      },
      {
        id: "requestOwner",
        label: "申请人",
        type: "text",
        required: true,
        description: "发起流程的责任人。",
        extractionHints: ["申请人", "负责人", "owner"],
        placeholder: "例如：张三"
      },
      {
        id: "dueDate",
        label: "期望完成日期",
        type: "date",
        required: false,
        description: "业务系统处理截止时间。",
        extractionHints: ["完成日期", "截止日期", "due date"],
        placeholder: "YYYY-MM-DD"
      }
    ],
    knowledgeRefs: [
      {
        id: "default-playbook",
        title: "默认办理指引",
        summary: "用于快速落地新场景的标准执行模板。"
      }
    ],
    backendChecks: [
      {
        id: "basic_integrity",
        label: "基础合法性校验",
        severity: "warning",
        description: "检查必填字段与基础约束。"
      }
    ],
    updatedAt: timestamp
  };

  await writeJson("scenarios.json", [scenario, ...scenarios]);
  return scenario;
}

export async function updateScenario(
  scenarioId: string,
  input: Partial<Omit<Scenario, "id" | "updatedAt">>
) {
  const scenarios = await getScenarios();
  const nextScenarios = scenarios.map((scenario) =>
    scenario.id === scenarioId
      ? {
          ...scenario,
          ...input,
          keywords: input.keywords ? sanitizeKeywords(input.keywords) : scenario.keywords,
          updatedAt: new Date().toISOString()
        }
      : scenario
  );

  const updatedScenario = nextScenarios.find((scenario) => scenario.id === scenarioId);
  if (!updatedScenario) {
    throw new Error("Scenario not found");
  }

  await writeJson("scenarios.json", nextScenarios);
  return updatedScenario;
}

export async function submitUserFeedback(taskId: string, input: UserFeedbackInput) {
  const [tasks, scenarios] = await Promise.all([getTasks(), getScenarios()]);
  const targetTask = tasks.find((task) => task.id === taskId);
  if (!targetTask) {
    throw new Error("Task not found");
  }

  const scenario = scenarios.find((item) => item.id === targetTask.scenarioId);
  if (!scenario) {
    throw new Error("Scenario not found");
  }

  const updatedTask = await applyUserFeedback(targetTask, scenario, input);
  const nextTasks = tasks.map((task) => (task.id === taskId ? updatedTask : task));
  await writeJson("tasks.json", nextTasks);
  return updatedTask;
}

export async function triggerBackendValidation(taskId: string) {
  const [tasks, scenarios] = await Promise.all([getTasks(), getScenarios()]);
  const targetTask = tasks.find((task) => task.id === taskId);
  if (!targetTask) {
    throw new Error("Task not found");
  }

  const scenario = scenarios.find((item) => item.id === targetTask.scenarioId);
  if (!scenario) {
    throw new Error("Scenario not found");
  }

  const updatedTask = applyBackendValidation(targetTask, scenario);
  const nextTasks = tasks.map((task) => (task.id === taskId ? updatedTask : task));
  await writeJson("tasks.json", nextTasks);
  return updatedTask;
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const [scenarios, tasks] = await Promise.all([getScenarios(), getTasks()]);
  const completedTasks = tasks.filter((task) => task.status === "completed").length;
  const attentionTasks = tasks.filter((task) => task.status !== "completed").length;
  const averageCompletion =
    tasks.length === 0
      ? 100
      : Math.round(tasks.reduce((sum, task) => sum + task.extraction.completionRate, 0) / tasks.length);

  return {
    scenarioCount: scenarios.length,
    taskCount: tasks.length,
    completedTasks,
    attentionTasks,
    averageCompletion
  };
}
