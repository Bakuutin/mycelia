export type JobInfo = {
  id: string;
  name?: string;
  type: string;
  data: any;
  state: string;
  progress: any;
  result?: any;
  trigger?: {
    type: "manual" | "auto";
    reason?: string;
    principal?: string;
  };
  timestamp: number;
  finishedOn?: number;
  processedOn?: number;
  failedReason?: string;
  attemptsMade?: number;
};


