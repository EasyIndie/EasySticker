/** 一张附加参考图（在 referenceImage* 之外再给的图）。 */
export type AiReferenceImage = {
  base64?: string;
  url?: string;
  mime?: string;
};

export type AiGenerateInput = {
  prompt: string;
  negativePrompt?: string;
  style?: string;
  width: number;
  height: number;
  referenceImageBase64?: string;
  referenceImageUrl?: string;
  referenceImageMime?: string;
  /**
   * 附加参考图，排在主参考图之后。
   * 只有部分模型支持多图输入 —— 为空时行为与以前完全一致（单图路径不变）。
   */
  additionalReferenceImages?: AiReferenceImage[];
  providerOptions?: Record<string, unknown>;
};

export type AiGenerateOutput = {
  mime: string;
  bytes: Buffer;
};

export interface AiProvider {
  generateImage(input: AiGenerateInput, signal?: AbortSignal): Promise<AiGenerateOutput>;
}
