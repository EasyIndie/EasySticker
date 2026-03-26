export type PublishStatus = "queued" | "running" | "succeeded" | "failed";

export type PublishJob = {
  jobId: string;
  provider: string;
  createdAt: string;
  status: PublishStatus;
  result?: unknown;
  error?: string;
};

export type TelegramPublishRequest = {
  token: string;
  userId: number;
  setName: string;
  setTitle: string;
  assetIds: string[];
  emojis?: string;
};

