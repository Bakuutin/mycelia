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
  failedType?: "offline" | "internal";
  attemptsMade?: number;
};

export interface JobLogEntry {
  _id?: string;
  jobId: string;
  stream: "stdout" | "stderr";
  text: string;
  timestamp: string;
}

export interface JobAccessLogEntry {
  _id: string;
  principal: string;
  resource: string;
  actions: Array<{
    path: string[];
    actions: string[];
  }>;
  timestamp: string;
}
