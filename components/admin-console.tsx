"use client";

import { useEffect, useMemo, useState } from "react";
import type { BackendCheck, KnowledgeReference, Scenario, ScenarioField, Task } from "@/lib/types";

interface AdminConsoleProps {
  initialScenarios: Scenario[];
  initialTasks: Task[];
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || "Request failed");
  }

  return (await response.json()) as T;
}

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}

function statusLabel(status: Task["status"]) {
  if (status === "completed") {
    return "已完成";
  }

  if (status === "awaiting_backend") {
    return "待后端";
  }

  return "待用户";
}

function statusClass(status: Task["status"]) {
  if (status === "completed") {
    return "tone-success";
  }

  if (status === "awaiting_backend") {
    return "tone-info";
  }

  return "tone-warning";
}

function schemaToText(schema: ScenarioField[]) {
  return JSON.stringify(schema, null, 2);
}

function refsToText(references: KnowledgeReference[]) {
  return references.map((reference) => `${reference.id}|${reference.title}|${reference.summary}`).join("\n");
}

function checksToText(checks: BackendCheck[]) {
  return checks.map((check) => `${check.id}|${check.label}|${check.severity}|${check.description}`).join("\n");
}

export function AdminConsole({ initialScenarios, initialTasks }: AdminConsoleProps) {
  const [scenarios, setScenarios] = useState(initialScenarios);
  const [tasks] = useState(initialTasks);
  const [selectedScenarioId, setSelectedScenarioId] = useState(initialScenarios[0]?.id ?? "");
  const [editor, setEditor] = useState({
    name: "",
    category: "",
    description: "",
    keywords: "",
    schemaVersion: "v1.0.0",
    schema: "[]",
    knowledgeRefs: "",
    backendChecks: ""
  });
  const [newScenario, setNewScenario] = useState({
    name: "差旅申请",
    category: "行政运营",
    description: "用于差旅单、行程审批和预算流转。"
  });
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selectedScenario = useMemo(
    () => scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? null,
    [scenarios, selectedScenarioId]
  );

  useEffect(() => {
    if (!selectedScenario) {
      return;
    }

    setEditor({
      name: selectedScenario.name,
      category: selectedScenario.category,
      description: selectedScenario.description,
      keywords: selectedScenario.keywords.join(", "),
      schemaVersion: selectedScenario.schemaVersion,
      schema: schemaToText(selectedScenario.schema),
      knowledgeRefs: refsToText(selectedScenario.knowledgeRefs),
      backendChecks: checksToText(selectedScenario.backendChecks)
    });
  }, [selectedScenario]);

  const metrics = useMemo(() => {
    const completed = tasks.filter((task) => task.status === "completed").length;
    const active = tasks.length - completed;
    const highAttention = tasks.filter((task) => task.backendFeedback.some((item) => item.status === "needs_attention")).length;
    return { completed, active, highAttention };
  }, [tasks]);

  async function handleCreateScenario() {
    setBusyAction("create");
    setError("");
    setSuccess("");

    try {
      const scenario = await requestJson<Scenario>("/api/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newScenario)
      });

      setScenarios((current) => [scenario, ...current]);
      setSelectedScenarioId(scenario.id);
      setSuccess("新场景已创建，可以继续完善 Schema 与知识配置。");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "创建场景失败。");
    } finally {
      setBusyAction("");
    }
  }

  async function handleSaveScenario() {
    if (!selectedScenario) {
      return;
    }

    setBusyAction("save");
    setError("");
    setSuccess("");

    try {
      const parsedSchema = JSON.parse(editor.schema) as ScenarioField[];
      const parsedRefs = editor.knowledgeRefs
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [id, title, summary] = line.split("|");
          return {
            id: id?.trim() || `ref-${Math.random().toString(36).slice(2, 8)}`,
            title: title?.trim() || "未命名知识",
            summary: summary?.trim() || ""
          };
        });
      const parsedChecks = editor.backendChecks
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [id, label, severity, description] = line.split("|");
          return {
            id: id?.trim() || `check-${Math.random().toString(36).slice(2, 8)}`,
            label: label?.trim() || "未命名校验",
            severity: severity?.trim() === "error" ? "error" : "warning",
            description: description?.trim() || ""
          };
        }) as BackendCheck[];

      const updatedScenario = await requestJson<Scenario>(`/api/scenarios/${selectedScenario.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editor.name,
          category: editor.category,
          description: editor.description,
          keywords: editor.keywords.split(",").map((item) => item.trim()),
          schemaVersion: editor.schemaVersion,
          schema: parsedSchema,
          knowledgeRefs: parsedRefs,
          backendChecks: parsedChecks
        })
      });

      setScenarios((current) => current.map((scenario) => (scenario.id === updatedScenario.id ? updatedScenario : scenario)));
      setSuccess("场景配置已保存，新的 Schema 会立即影响后续任务抽取。");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "保存场景失败。");
    } finally {
      setBusyAction("");
    }
  }

  return (
    <div className="page-stack">
      <section className="hero hero-admin">
        <div>
          <span className="eyebrow">Control Plane</span>
          <h1>后台管理与 Intent-Flow Agent 配置中心</h1>
          <p>管理员可以在这里维护场景注册表、Schema 合约、知识片段和后端校验规则，并实时查看任务运行态。</p>
        </div>
        <div className="hero-highlight">
          <strong>{scenarios.length}</strong>
          <span>场景模板</span>
          <strong>{metrics.highAttention}</strong>
          <span>高关注任务</span>
        </div>
      </section>

      <section className="stats-grid">
        <article className="metric-card">
          <span>活跃任务</span>
          <strong>{metrics.active}</strong>
          <p>处于用户修订或后端校验中的任务。</p>
        </article>
        <article className="metric-card">
          <span>已闭环任务</span>
          <strong>{metrics.completed}</strong>
          <p>完整通过双反馈验证的任务数量。</p>
        </article>
        <article className="metric-card">
          <span>高关注任务</span>
          <strong>{metrics.highAttention}</strong>
          <p>最近一次后端校验产生关注项的任务。</p>
        </article>
      </section>

      <section className="admin-grid">
        <div className="panel-column">
          <article className="panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Registry</span>
                <h2>场景注册表</h2>
              </div>
            </div>

            <div className="scenario-create">
              <label className="field">
                <span>新场景名称</span>
                <input
                  value={newScenario.name}
                  onChange={(event) => setNewScenario((current) => ({ ...current, name: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>业务分类</span>
                <input
                  value={newScenario.category}
                  onChange={(event) => setNewScenario((current) => ({ ...current, category: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>场景描述</span>
                <textarea
                  rows={3}
                  value={newScenario.description}
                  onChange={(event) => setNewScenario((current) => ({ ...current, description: event.target.value }))}
                />
              </label>
              <button className="button-primary" onClick={handleCreateScenario} disabled={busyAction === "create"}>
                {busyAction === "create" ? "创建中..." : "新增场景"}
              </button>
            </div>

            <div className="scenario-list">
              {scenarios.map((scenario) => (
                <button
                  key={scenario.id}
                  type="button"
                  className={`task-list__item ${scenario.id === selectedScenarioId ? "task-list__item--active" : ""}`}
                  onClick={() => setSelectedScenarioId(scenario.id)}
                >
                  <div className="task-list__title">
                    <strong>{scenario.name}</strong>
                    <span className="status-pill tone-info">{scenario.category}</span>
                  </div>
                  <p>{scenario.description}</p>
                  <small>{scenario.schema.length} 个字段 · {scenario.backendChecks.length} 条校验</small>
                </button>
              ))}
            </div>
          </article>
        </div>

        <article className="panel panel-detail">
          {selectedScenario ? (
            <>
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Editor</span>
                  <h2>{selectedScenario.name}</h2>
                </div>
                <button className="button-primary" onClick={handleSaveScenario} disabled={busyAction === "save"}>
                  {busyAction === "save" ? "保存中..." : "保存配置"}
                </button>
              </div>

              <div className="detail-grid detail-grid--admin">
                <label className="field">
                  <span>场景名称</span>
                  <input value={editor.name} onChange={(event) => setEditor((current) => ({ ...current, name: event.target.value }))} />
                </label>
                <label className="field">
                  <span>业务分类</span>
                  <input
                    value={editor.category}
                    onChange={(event) => setEditor((current) => ({ ...current, category: event.target.value }))}
                  />
                </label>
                <label className="field field-full">
                  <span>场景描述</span>
                  <textarea
                    rows={3}
                    value={editor.description}
                    onChange={(event) => setEditor((current) => ({ ...current, description: event.target.value }))}
                  />
                </label>
                <label className="field">
                  <span>关键词</span>
                  <input
                    value={editor.keywords}
                    onChange={(event) => setEditor((current) => ({ ...current, keywords: event.target.value }))}
                    placeholder="用逗号分隔，例如：入职, onboarding, 新员工"
                  />
                </label>
                <label className="field">
                  <span>Schema 版本</span>
                  <input
                    value={editor.schemaVersion}
                    onChange={(event) => setEditor((current) => ({ ...current, schemaVersion: event.target.value }))}
                  />
                </label>
                <label className="field field-full">
                  <span>Schema JSON</span>
                  <textarea
                    rows={16}
                    value={editor.schema}
                    onChange={(event) => setEditor((current) => ({ ...current, schema: event.target.value }))}
                  />
                </label>
                <label className="field field-full">
                  <span>知识引用</span>
                  <textarea
                    rows={6}
                    value={editor.knowledgeRefs}
                    onChange={(event) => setEditor((current) => ({ ...current, knowledgeRefs: event.target.value }))}
                    placeholder="每行一个：id|title|summary"
                  />
                </label>
                <label className="field field-full">
                  <span>后端校验</span>
                  <textarea
                    rows={6}
                    value={editor.backendChecks}
                    onChange={(event) => setEditor((current) => ({ ...current, backendChecks: event.target.value }))}
                    placeholder="每行一个：id|label|severity|description"
                  />
                </label>
              </div>

              {error ? <p className="form-error">{error}</p> : null}
              {success ? <p className="form-success">{success}</p> : null}

              <section className="subpanel">
                <div className="subpanel-header">
                  <h3>最近任务监控</h3>
                  <span>{tasks.length} 条</span>
                </div>
                <div className="task-table">
                  <div className="task-table__head">
                    <span>任务</span>
                    <span>状态</span>
                    <span>完整度</span>
                    <span>更新时间</span>
                  </div>
                  {tasks.map((task) => (
                    <div className="task-table__row" key={task.id}>
                      <span>
                        <strong>{task.scenarioName}</strong>
                        <small>{task.request}</small>
                      </span>
                      <span className={`status-pill ${statusClass(task.status)}`}>{statusLabel(task.status)}</span>
                      <span>{task.extraction.completionRate}%</span>
                      <span>{formatDateTime(task.updatedAt)}</span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : (
            <div className="empty-view">
              <h2>没有可编辑的场景</h2>
              <p>先在左侧创建一个场景模板，平台会自动生成基础 Schema。</p>
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
