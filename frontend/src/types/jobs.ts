export type JobInfo = {
  id: string;
  name?: string;
  type: string;
  data: any;
  state: string;
  progress: any;
  result?: any;
  timestamp: number;
  finishedOn?: number;
  processedOn?: number;
  failedReason?: string;
  attemptsMade?: number;
};

