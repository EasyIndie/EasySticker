export type AiGenerateInput = {
  prompt: string;
  negativePrompt?: string;
  style?: string;
  width: number;
  height: number;
  referenceImageTransport?: "base64" | "url" | "assetId" | "multipart";
  referenceImageBase64?: string;
  referenceImageUrl?: string;
  referenceImageMime?: string;
  referenceImageAssetId?: string;
  providerOptions?: Record<string, unknown>;
};

export type AiGenerateOutput = {
  mime: string;
  bytes: Buffer;
};

export interface AiProvider {
  generateImage(input: AiGenerateInput, signal?: AbortSignal): Promise<AiGenerateOutput>;
}
