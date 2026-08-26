import { useEffect, useMemo, useRef, useState } from "react";
import { api, callResource } from "@/lib/api";
import { subscribeToJob } from "@/lib/jobs";
import Form from "@rjsf/shadcn";
import validator from "@rjsf/validator-ajv8";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/DateRangePicker";
import { CheckCircle2, Loader2, Play, XCircle } from "lucide-react";
import { useTimelineTimeZone } from "@/hooks/useTimelineTimeZone";

interface RunJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startDate: Date;
  endDate: Date;
}

function hasStartEndProperties(schema: any): boolean {
  if (!schema?.input?.properties) return false;
  return "start" in schema.input.properties && "end" in schema.input.properties;
}

export function RunJobDialog({
  open,
  onOpenChange,
  startDate,
  endDate,
}: RunJobDialogProps) {
  const { resolveTimeZone } = useTimelineTimeZone();
  const [schemas, setSchemas] = useState<Record<string, any> | null>(null);
  const [isLoadingSchemas, setIsLoadingSchemas] = useState(false);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editableStart, setEditableStart] = useState<Date>(startDate);
  const [editableEnd, setEditableEnd] = useState<Date>(endDate);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const eligibleJobTypes = useMemo(() => {
    if (!schemas) return [];
    return Object.entries(schemas)
      .filter(([_, schema]) => hasStartEndProperties(schema))
      .map(([type]) => type);
  }, [schemas]);

  const currentSchema = useMemo(() => {
    if (!selectedType || !schemas?.[selectedType]?.input) return null;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { $schema, ...schemaWithoutDraft } = schemas[selectedType].input;
    const schema = { ...schemaWithoutDraft };
    if (schema.properties) {
      const { start, end, ...otherProps } = schema.properties;
      schema.properties = otherProps;

      if (schema.required) {
        schema.required = schema.required.filter(
          (r: string) => r !== "start" && r !== "end",
        );
      }
    }
    return schema;
  }, [selectedType, schemas]);

  useEffect(() => {
    if (open) {
      setEditableStart(startDate);
      setEditableEnd(endDate);
      const fetchSchemas = async () => {
        setIsLoadingSchemas(true);
        try {
          const response = await api.callResource("jobs", {
            action: "schemas",
          });
          setSchemas(response as Record<string, any>);
        } catch (e) {
          console.error("Failed to fetch job schemas:", e);
          setError("Failed to load job schemas");
        } finally {
          setIsLoadingSchemas(false);
        }
      };
      fetchSchemas();
    } else {
      resetDialog();
    }
  }, [open, startDate, endDate]);

  const resetDialog = () => {
    setJobStatus(null);
    setError(null);
    setSelectedType(null);
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
  };

  const handleSubmit = async (formData: any) => {
    if (!selectedType) return;

    setJobStatus("starting");
    setError(null);

    try {
      const response = await callResource("jobs", {
        action: "enqueue",
        data: {
          ...formData,
          type: selectedType,
          start: editableStart,
          end: editableEnd,
        },
        trigger: {
          type: "manual",
          reason:
            `Manual launch of ${selectedType} from timeline range selection`,
        },
      }) as { jobId?: string };

      const jobId = response.jobId;
      if (!jobId) {
        throw new Error("No job ID returned");
      }

      setJobStatus("waiting");

      unsubscribeRef.current = subscribeToJob(jobId, (update) => {
        setJobStatus(update.state);

        if (update.state === "completed") {
          setTimeout(() => {
            onOpenChange(false);
          }, 1500);
        } else if (update.state === "failed") {
          setError(update.failedReason || "Job failed");
        }
      });
    } catch (e) {
      console.error("Failed to start job:", e);
      setError("Failed to start job");
      setJobStatus(null);
    }
  };

  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, []);

  const isJobInProgress = jobStatus &&
    ["starting", "waiting", "active", "delayed"].includes(jobStatus);
  const isJobComplete = jobStatus === "completed";
  const isJobFailed = jobStatus === "failed";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Run Job on Range</DialogTitle>
          <DialogDescription>
            Select a job type to run on the selected time range.
          </DialogDescription>
        </DialogHeader>

        <div className="grid w-full gap-4 py-4">
          {error && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <XCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {isJobInProgress && (
            <div className="flex items-center gap-3 rounded-md bg-blue-500/10 p-4 text-sm text-blue-600 dark:text-blue-400">
              <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin" />
              <div className="flex-1">
                <div className="font-medium">
                  {selectedType} job is running in background
                </div>
                <div className="text-xs opacity-80 mt-1">
                  You can close this dialog and check progress in the Jobs page
                </div>
              </div>
            </div>
          )}

          {isJobComplete && (
            <div className="flex items-center gap-2 rounded-md bg-green-500/10 p-3 text-sm text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              Job completed successfully
            </div>
          )}

          <DateRangePicker
            label="Timeline range"
            value={{ start: editableStart, end: editableEnd }}
            onChange={(value) => {
              setEditableStart(value.start);
              if (value.end) setEditableEnd(value.end);
            }}
            disabled={Boolean(isJobInProgress || isJobComplete)}
            showAudioTimeline
            timeZone={resolveTimeZone(editableStart)}
          />

          {!isJobInProgress && !isJobComplete && (
            <div className="grid gap-2">
              <Label htmlFor="job-type">Job Type</Label>
              <Select
                value={selectedType || undefined}
                onValueChange={setSelectedType}
                disabled={isLoadingSchemas}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a job type..." />
                </SelectTrigger>
                <SelectContent>
                  {isLoadingSchemas
                    ? (
                      <SelectItem value="loading" disabled>
                        Loading schemas...
                      </SelectItem>
                    )
                    : eligibleJobTypes.length === 0
                    ? (
                      <SelectItem value="none" disabled>
                        No compatible job types found
                      </SelectItem>
                    )
                    : (
                      eligibleJobTypes.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))
                    )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Only jobs that accept start/end time ranges are shown.
              </p>
            </div>
          )}

          {!isJobInProgress && !isJobComplete && selectedType &&
            currentSchema && (
            <div className="border-t pt-4">
              <Label className="mb-3 block">
                {selectedType} Configuration
              </Label>
              <div className="rjsf-container">
                <Form
                  schema={currentSchema}
                  validator={validator}
                  onSubmit={(data: any) => handleSubmit(data.formData)}
                  noHtml5Validate
                  showErrorList={false}
                  liveValidate={false}
                >
                  <div className="mt-4">
                    <Button
                      type="submit"
                      disabled={!selectedType}
                      className="w-full"
                    >
                      <Play className="mr-2 h-4 w-4" />
                      Run Job
                    </Button>
                  </div>
                </Form>
              </div>
            </div>
          )}

          {!isJobInProgress && !isJobComplete && selectedType &&
            !currentSchema && !isLoadingSchemas && (
            <div className="border-t pt-4">
              <Button
                onClick={() => handleSubmit({})}
                disabled={!selectedType}
                className="w-full"
              >
                <Play className="mr-2 h-4 w-4" />
                Run Job
              </Button>
            </div>
          )}
        </div>

        {isJobInProgress && (
          <DialogFooter className="sm:justify-center">
            <Button
              onClick={() => onOpenChange(false)}
              className="w-full sm:w-auto min-w-[200px]"
            >
              Continue in Background
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
