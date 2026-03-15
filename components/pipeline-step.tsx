interface PipelineStepProps {
  title: string;
  description: string;
  status: "complete" | "active" | "waiting";
  detail?: string;
}

export function PipelineStep({ title, description, status, detail }: PipelineStepProps) {
  return (
    <article className={`pipeline-step pipeline-${status}`}>
      <div className="pipeline-step__header">
        <span className="pipeline-step__badge">{status === "complete" ? "完成" : status === "active" ? "进行中" : "待处理"}</span>
        <h3>{title}</h3>
      </div>
      <p>{description}</p>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}
