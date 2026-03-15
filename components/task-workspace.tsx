"use client";

import { useEffect, useMemo, useState } from "react";
import { PipelineStep } from "@/components/pipeline-step";
import type { Scenario, Task } from "@/lib/types";

interface TaskWorkspaceProps {
  initialScenarios: Scenario[];
  initialTasks: Task[];
  initialActiveTaskId?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

type StreamStage = "idle" | "planning" | "retrieval" | "extraction" | "ready";

type TaskStreamEvent =
  | { type: "token"; text: string }
  | { type: "stage"; stage: "planning" | "retrieval" | "extraction"; detail: string }
  | { type: "task"; task: Task }
  | { type: "error"; message: string }
  | { type: "done" };

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
    return "待后端校验";
  }

  return "待用户确认";
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

function feedbackTone(status: "accepted" | "needs_attention" | "passed") {
  if (status === "passed") {
    return "feedback-pass";
  }

  if (status === "accepted") {
    return "feedback-accept";
  }

  return "feedback-attention";
}

function buildDraftFromTask(task: Task | null, scenario: Scenario | null) {
  if (!task || !scenario) {
    return {} as Record<string, string>;
  }

  return Object.fromEntries(
    scenario.schema.map((field) => [field.id, task.schemaFinal[field.id] ?? ""])
  ) as Record<string, string>;
}

function createChatId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function TaskWorkspace({ initialScenarios, initialTasks, initialActiveTaskId }: TaskWorkspaceProps) {
  const [scenarios] = useState(initialScenarios);
  const [tasks, setTasks] = useState(initialTasks);
  const [request, setRequest] = useState(
    "请帮我办理员工入职：姓名张三，证件号110101199003074560，入职日期2026-03-18，部门财务中心，办公地深圳，直属经理王敏，邮箱zhangsan@company.com，需要笔记本和门禁。"
  );
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>("");
  const [activeTaskId, setActiveTaskId] = useState(
    initialTasks.some((task) => task.id === initialActiveTaskId) ? initialActiveTaskId ?? "" : initialTasks[0]?.id ?? ""
  );
  const [feedbackNote, setFeedbackNote] = useState("");
  const [editableDraft, setEditableDraft] = useState<Record<string, string>>(
    buildDraftFromTask(initialTasks[0] ?? null, initialScenarios.find((scenario) => scenario.id === initialTasks[0]?.scenarioId) ?? null)
  );
  const [busyAction, setBusyAction] = useState<string>("");
  const [error, setError] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: createChatId(),
      role: "assistant",
        content: "你好，我是 Intent-Flow Agent。请在下方输入业务诉求，我会流式展示从 Step 1 到 Step 2 的解析过程。"
    }
  ]);
  const [streamStage, setStreamStage] = useState<StreamStage>("idle");
  const [streamStageDetails, setStreamStageDetails] = useState<Record<Exclude<StreamStage, "idle" | "ready">, string>>({
    planning: "",
    retrieval: "",
    extraction: ""
  });

  const activeTask = useMemo(
    () => tasks.find((task) => task.id === activeTaskId) ?? tasks[0] ?? null,
    [activeTaskId, tasks]
  );

  const activeScenario = useMemo(
    () => scenarios.find((scenario) => scenario.id === activeTask?.scenarioId) ?? null,
    [activeTask?.scenarioId, scenarios]
  );

  const taskMetrics = useMemo(() => {
    const completed = tasks.filter((task) => task.status === "completed").length;
    const pending = tasks.filter((task) => task.status !== "completed").length;
    const averageCompletion =
      tasks.length === 0
        ? 0
        : Math.round(tasks.reduce((sum, task) => sum + task.extraction.completionRate, 0) / tasks.length);

    return { completed, pending, averageCompletion };
  }, [tasks]);

  const hasDraftChanges = useMemo(() => {
    if (!activeTask || !activeScenario) {
      return false;
    }

    return activeScenario.schema.some((field) => (editableDraft[field.id] ?? "") !== (activeTask.schemaFinal[field.id] ?? ""));
  }, [activeScenario, activeTask, editableDraft]);

  const planningStepDetail = activeTask
    ? `${Math.round(activeTask.planning.confidence * 100)}% 置信度 · ${activeTask.planning.reasoning}`
    : streamStageDetails.planning || "等待任务创建。";
  const retrievalStepDetail = activeTask
    ? `Schema ${activeTask.retrieval.schemaVersion} · ${activeTask.retrieval.knowledgeRefs.length} 条知识引用`
    : streamStageDetails.retrieval || "等待检索。";
  const extractionStepDetail = activeTask
    ? `完整度 ${activeTask.extraction.completionRate}% · 缺失 ${activeTask.extraction.missingFields.length} 项`
    : streamStageDetails.extraction || "等待抽取。";

  useEffect(() => {
    setEditableDraft(buildDraftFromTask(activeTask, activeScenario));
    setFeedbackNote("");
  }, [activeScenario, activeTask]);

  function handleDraftFieldChange(fieldId: string, value: string) {
    setEditableDraft((current) => ({
      ...current,
      [fieldId]: value
    }));
  }

  function resetDraftEditor() {
    setEditableDraft(buildDraftFromTask(activeTask, activeScenario));
    setFeedbackNote("");
  }

  function appendAssistantToken(token: string) {
    setChatMessages((current) => {
      const last = current[current.length - 1];
      if (last && last.role === "assistant" && last.streaming) {
        return [...current.slice(0, -1), { ...last, content: `${last.content}${token}` }];
      }

      return [...current, { id: createChatId(), role: "assistant", content: token, streaming: true }];
    });
  }

  function finalizeAssistantToken() {
    setChatMessages((current) => {
      const last = current[current.length - 1];
      if (!last || !last.streaming) {
        return current;
      }
      return [...current.slice(0, -1), { ...last, streaming: false }];
    });
  }

  function appendAssistantMessage(content: string) {
    setChatMessages((current) => [...current, { id: createChatId(), role: "assistant", content }]);
  }

  function applyStreamEvent(event: TaskStreamEvent) {
    if (event.type === "token") {
      appendAssistantToken(event.text);
      return;
    }

    if (event.type === "stage") {
      setStreamStage(event.stage);
      setStreamStageDetails((current) => ({
        ...current,
        [event.stage]: event.detail
      }));
      return;
    }

    if (event.type === "task") {
      setTasks((current) => [event.task, ...current]);
      setActiveTaskId(event.task.id);
      setFeedbackNote("");
      setStreamStage("ready");
      return;
    }

    if (event.type === "error") {
      setError(event.message);
      appendAssistantMessage(`处理失败：${event.message}`);
      return;
    }

    if (event.type === "done") {
      finalizeAssistantToken();
    }
  }

  async function handleCreateTask() {
    if (!request.trim()) {
      setError("请输入用户原始指令。");
      return;
    }

    setBusyAction("create");
    setError("");
    setStreamStage("planning");
    setChatMessages((current) => [...current, { id: createChatId(), role: "user", content: request.trim() }]);
    const submittedRequest = request.trim();

    try {
      const response = await fetch("/api/tasks/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: submittedRequest,
          scenarioId: selectedScenarioId || undefined
        })
      });

      if (!response.ok || !response.body) {
        const message = await response.text();
        throw new Error(message || "创建任务失败。");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        let lineBreak = buffer.indexOf("\n");
        while (lineBreak >= 0) {
          const line = buffer.slice(0, lineBreak).trim();
          buffer = buffer.slice(lineBreak + 1);
          if (line) {
            applyStreamEvent(JSON.parse(line) as TaskStreamEvent);
          }
          lineBreak = buffer.indexOf("\n");
        }
      }

      finalizeAssistantToken();
      setRequest("");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "创建任务失败。");
      finalizeAssistantToken();
      setStreamStage("idle");
    } finally {
      setBusyAction("");
    }
  }

  async function handleUserFeedback(action: "revise" | "confirm") {
    if (!activeTask || !activeScenario) {
      return;
    }

    setBusyAction(action);
    setError("");

    try {
      const updatedTask = await requestJson<Task>(`/api/tasks/${activeTask.id}/user-feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft: editableDraft,
          note: feedbackNote,
          action
        })
      });

      setTasks((current) => current.map((task) => (task.id === updatedTask.id ? updatedTask : task)));
      setEditableDraft(buildDraftFromTask(updatedTask, activeScenario));
      setFeedbackNote("");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "提交反馈失败。");
    } finally {
      setBusyAction("");
    }
  }

  async function handleBackendValidation() {
    if (!activeTask) {
      return;
    }

    setBusyAction("backend");
    setError("");

    try {
      const updatedTask = await requestJson<Task>(`/api/tasks/${activeTask.id}/backend-feedback`, {
        method: "POST"
      });

      setTasks((current) => current.map((task) => (task.id === updatedTask.id ? updatedTask : task)));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "后端校验失败。");
    } finally {
      setBusyAction("");
    }
  }

  return (
    <div className="page-stack">
      <section className="hero hero-workspace">
        <div>
          <span className="eyebrow">Task Studio</span>
          <h1>面向复杂业务流程的 Intent-Flow Agent 工作台</h1>
          <p>
            这里把你的方案完整落成可操作平台：前台做意图理解、Schema 抽取与双反馈闭环，后台做场景配置、知识管理与任务监控。
          </p>
        </div>
        <div className="hero-highlight">
          <strong>{scenarios.length}</strong>
          <span>可路由场景</span>
          <strong>{taskMetrics.averageCompletion}%</strong>
          <span>平均抽取完整度</span>
        </div>
      </section>

      <section className="stats-grid">
        <article className="metric-card">
          <span>待处理任务</span>
          <strong>{taskMetrics.pending}</strong>
          <p>需要用户确认或后端校验的活跃任务。</p>
        </article>
        <article className="metric-card">
          <span>已闭环任务</span>
          <strong>{taskMetrics.completed}</strong>
          <p>已经通过双层反馈验证并可提交业务系统。</p>
        </article>
        <article className="metric-card">
          <span>接入场景</span>
          <strong>{scenarios.length}</strong>
          <p>支持从 RAG 场景库中动态检索 Schema。</p>
        </article>
      </section>

      <section className="workspace-grid">
        <div className="panel-column">
          <article className="panel panel-chat">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Step 1 → Step 2</span>
                <h2>Chat 交互式任务创建</h2>
              </div>
            </div>

            <div className="chat-thread">
              {chatMessages.map((message) => (
                <article
                  key={message.id}
                  className={`chat-bubble ${message.role === "user" ? "chat-bubble-user" : "chat-bubble-assistant"}`}
                >
                  <span className="chat-bubble__role">{message.role === "user" ? "你" : "Intent-Flow Agent"}</span>
                  <p>{message.content}</p>
                  {message.streaming ? <span className="chat-bubble__streaming">流式输出中...</span> : null}
                </article>
              ))}
            </div>

            <label className="field">
              <span>预选场景（可选）</span>
              <select value={selectedScenarioId} onChange={(event) => setSelectedScenarioId(event.target.value)}>
                <option value="">让系统自动路由</option>
                {scenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>输入业务诉求</span>
              <textarea
                rows={4}
                value={request}
                onChange={(event) => setRequest(event.target.value)}
                placeholder="输入业务诉求，例如：帮我办理入职、申请采购、发起请假流程..."
              />
            </label>
            <div className="button-row">
              <button className="button-primary" onClick={handleCreateTask} disabled={busyAction === "create"}>
                {busyAction === "create" ? "Intent-Flow Agent 处理中..." : "发送并启动 Intent-Flow Agent"}
              </button>
            </div>
            {error ? <p className="form-error">{error}</p> : null}
          </article>

        </div>

        <article className="panel panel-detail">
          {activeTask && activeScenario ? (
            <>
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Step 2</span>
                  <h2>{activeTask.scenarioName}</h2>
                </div>
                <div className="task-header-actions">
                  <select value={activeTask.id} onChange={(event) => setActiveTaskId(event.target.value)}>
                    {tasks.map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.scenarioName} · {statusLabel(task.status)}
                      </option>
                    ))}
                  </select>
                  <span className={`status-pill ${statusClass(activeTask.status)}`}>{statusLabel(activeTask.status)}</span>
                </div>
              </div>

              <div className="pipeline-grid">
                <PipelineStep
                  title="Planning"
                  description="意图识别与场景路由"
                  status={
                    streamStage === "planning"
                      ? "active"
                      : streamStage === "idle" && !activeTask
                        ? "waiting"
                        : "complete"
                  }
                  detail={planningStepDetail}
                />
                <PipelineStep
                  title="RAG Retrieval"
                  description="根据场景匹配 Schema 与知识片段"
                  status={
                    streamStage === "retrieval"
                      ? "active"
                      : streamStage === "extraction" || streamStage === "ready" || Boolean(activeTask)
                        ? "complete"
                        : "waiting"
                  }
                  detail={retrievalStepDetail}
                />
                <PipelineStep
                  title="Extraction"
                  description="调用工具抽取结构化字段"
                  status={
                    streamStage === "extraction"
                      ? "active"
                      : streamStage === "ready" || Boolean(activeTask)
                        ? "complete"
                        : "waiting"
                  }
                  detail={extractionStepDetail}
                />
                <PipelineStep
                  title="Feedback Loop"
                  description="用户修正与后端校验形成双闭环"
                  status={activeTask.status === "completed" ? "complete" : "active"}
                  detail={`用户反馈 ${activeTask.userFeedback.length} 条 · 后端反馈 ${activeTask.backendFeedback.length} 条`}
                />
              </div>

              <div className="detail-grid">
                <section className="subpanel">
                  <div className="subpanel-header">
                    <h3>Schema 预览</h3>
                    <span>{activeTask.extraction.completionRate}%</span>
                  </div>
                  <div className="schema-table">
                    {activeScenario.schema.map((field) => {
                      const value = activeTask.schemaFinal[field.id];
                      const isMissing = field.required && !value;
                      return (
                        <div className={`schema-row ${isMissing ? "schema-row--missing" : ""}`} key={field.id}>
                          <span>{field.label}</span>
                          <strong>{value || "待补充"}</strong>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="subpanel">
                  <div className="subpanel-header">
                    <h3>知识关联</h3>
                    <span>{activeScenario.knowledgeRefs.length} 条</span>
                  </div>
                  <ul className="knowledge-list">
                    {activeScenario.knowledgeRefs.map((reference) => (
                      <li key={reference.id}>
                        <strong>{reference.title}</strong>
                        <p>{reference.summary}</p>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="subpanel field-full">
                  <div className="subpanel-header">
                    <h3>PRD链接解析</h3>
                    <span>{activeTask.linkedContent?.detectedUrls.length ?? 0} 条</span>
                  </div>
                  {activeTask.linkedContent?.detectedUrls.length ? (
                    <div className="task-list">
                      {activeTask.linkedContent.successfulReads.map((item) => (
                        <article key={`success-${item.url}`} className="feedback-item feedback-pass">
                          <strong>读取成功</strong>
                          <small>{item.url}</small>
                          <p>{item.summary}</p>
                        </article>
                      ))}
                      {activeTask.linkedContent.failedReads.map((item) => (
                        <article key={`failed-${item.url}`} className="feedback-item feedback-attention">
                          <strong>读取失败</strong>
                          <small>{item.url}</small>
                          <p>{item.reason}</p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-state">未检测到 PRD 链接，按用户原始输入进行抽取。</p>
                  )}
                </section>
              </div>

              <section className="subpanel">
                <div className="subpanel-header">
                  <h3>双层反馈</h3>
                  <span>用户修正 + 后端校验</span>
                </div>
                <div className="revision-grid">
                  <div className="revision-grid__head">
                    <span>字段</span>
                    <span>填写内容</span>
                  </div>
                  {activeScenario.schema.map((field) => {
                    const value = editableDraft[field.id] ?? "";
                    const isChanged = value !== (activeTask.schemaFinal[field.id] ?? "");
                    const isMissing = field.required && !value;

                    return (
                      <div className={`revision-row ${isChanged ? "revision-row--changed" : ""}`} key={field.id}>
                        <div className="revision-row__meta">
                          <div className="revision-row__title">
                            <strong>{field.label}</strong>
                            {field.required ? <span className="required-pill">必填</span> : null}
                            {isMissing ? <span className="missing-pill">缺失</span> : null}
                          </div>
                          <p>{field.description}</p>
                        </div>
                        <div className="revision-row__input">
                          {field.type === "textarea" ? (
                            <textarea
                              rows={3}
                              value={value}
                              onChange={(event) => handleDraftFieldChange(field.id, event.target.value)}
                              placeholder={field.placeholder || `请输入${field.label}`}
                            />
                          ) : field.type === "select" ? (
                            <select value={value} onChange={(event) => handleDraftFieldChange(field.id, event.target.value)}>
                              <option value="">请选择{field.label}</option>
                              {(field.options ?? []).map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type={field.type === "date" ? "date" : field.type === "email" ? "email" : "text"}
                              value={value}
                              onChange={(event) => handleDraftFieldChange(field.id, event.target.value)}
                              placeholder={field.placeholder || `请输入${field.label}`}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <label className="field">
                  <span>补充说明（可选）</span>
                  <textarea
                    rows={3}
                    value={feedbackNote}
                    onChange={(event) => setFeedbackNote(event.target.value)}
                    placeholder="如果你希望模型辅助理解这次修改，可以补充一句自然语言说明。"
                  />
                </label>
                <div className="button-row">
                  <button
                    className="button-secondary"
                    onClick={() => handleUserFeedback("revise")}
                    disabled={busyAction === "revise" || (!hasDraftChanges && !feedbackNote.trim())}
                  >
                    {busyAction === "revise" ? "提交中..." : "提交表格修订"}
                  </button>
                  <button
                    className="button-primary"
                    onClick={() => handleUserFeedback("confirm")}
                    disabled={busyAction === "confirm"}
                  >
                    {busyAction === "confirm" ? "确认中..." : "确认并进入后端校验"}
                  </button>
                  <button className="button-ghost" onClick={resetDraftEditor} disabled={!hasDraftChanges && !feedbackNote.trim()}>
                    重置表格
                  </button>
                  <button
                    className="button-ghost"
                    onClick={handleBackendValidation}
                    disabled={busyAction === "backend"}
                  >
                    {busyAction === "backend" ? "校验中..." : "执行后端校验"}
                  </button>
                </div>
              </section>

              <section className="timeline-grid">
                <div className="subpanel">
                  <div className="subpanel-header">
                    <h3>用户侧反馈</h3>
                    <span>{activeTask.userFeedback.length}</span>
                  </div>
                  <div className="feedback-list">
                    {activeTask.userFeedback.length === 0 ? (
                      <p className="empty-state">还没有用户修订记录。</p>
                    ) : (
                      activeTask.userFeedback.map((item) => (
                        <article className={`feedback-item ${feedbackTone(item.status)}`} key={item.id}>
                          <strong>{item.message}</strong>
                          <small>{formatDateTime(item.createdAt)}</small>
                        </article>
                      ))
                    )}
                  </div>
                </div>
                <div className="subpanel">
                  <div className="subpanel-header">
                    <h3>后端侧反馈</h3>
                    <span>{activeTask.backendFeedback.length}</span>
                  </div>
                  <div className="feedback-list">
                    {activeTask.backendFeedback.length === 0 ? (
                      <p className="empty-state">当前还没有后端校验结果。</p>
                    ) : (
                      activeTask.backendFeedback.map((item) => (
                        <article className={`feedback-item ${feedbackTone(item.status)}`} key={item.id}>
                          <strong>{item.message}</strong>
                          <small>{formatDateTime(item.createdAt)}</small>
                        </article>
                      ))
                    )}
                  </div>
                </div>
              </section>
            </>
          ) : (
            <div className="empty-view">
              <h2>还没有任务</h2>
              <p>先从左侧输入一条自然语言请求，启动一次完整的 Intent-Flow Agent 工作流。</p>
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
