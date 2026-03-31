export type AiGenerateInput = {
  prompt: string;
  negativePrompt?: string;
  style?: string;
  width: number;
  height: number;
};

export type AiGenerateOutput = {
  mime: string;
  bytes: Buffer;
};

export interface AiProvider {
  generateImage(input: AiGenerateInput): Promise<AiGenerateOutput>;
}

