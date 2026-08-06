import { CheckCircle2, XCircle } from "lucide-react";
import { ObjectChip } from "@/components/chat/chips";
import {
  getObjectRefFromOutput,
  summarizeToolCall,
} from "@/lib/toolPresentation";
import { cn } from "@/lib/utils";

/**
 * Compact confirmation card shown after a completed write action
 * (create / update / delete / merge / split), with a chip linking to the
 * affected object when the result carries a reference.
 */
export function ActionCard({
  toolName,
  input,
  output,
  state,
}: {
  toolName: string;
  input?: unknown;
  output?: unknown;
  state: string;
}) {
  const failed = state === "output-error";
  const summary = summarizeToolCall({ toolName, input, output, state });
  const ref = !failed ? getObjectRefFromOutput(output) : null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm",
        failed
          ? "border-red-500/30 bg-red-500/10"
          : "border-green-500/30 bg-green-500/10",
      )}
    >
      {failed
        ? <XCircle className="size-4 shrink-0 text-red-500" />
        : <CheckCircle2 className="size-4 shrink-0 text-green-600" />}
      <span className="min-w-0">{summary}</span>
      {ref && <ObjectChip id={ref.id} fallbackLabel={ref.name} />}
    </div>
  );
}
