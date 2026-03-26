export type BackgroundRemovalOptions = {
  threshold?: number;
  softness?: number;
};

export type ProcessImageTask = {
  inputPath: string;
  outputPath: string;
  options: BackgroundRemovalOptions;
};

export type ProcessImageResult = {
  width: number;
  height: number;
};

