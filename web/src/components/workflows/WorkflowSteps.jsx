import { CheckCircle2, Clock3 } from "lucide-react";

function stepClass(progress, index) {
  if (progress.status === "failed" && index === progress.activeStep) return "failed";
  if (progress.status === "done" || index < progress.activeStep) return "done";
  if (index === progress.activeStep && progress.status !== "idle") return "active";
  return "";
}

export function WorkflowSteps({ steps, progress }) {
  return (
    <div className="fixed-progress-steps">
      {steps.map((step, index) => {
        const tone = stepClass(progress, index);
        return (
          <span key={step} className={tone}>
            {tone === "done" ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}
            {step}
          </span>
        );
      })}
    </div>
  );
}
