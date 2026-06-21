/** Raised when required pipeline inputs (keypoints, frames3d) are missing. */
export class PipelineInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PipelineInputError';
  }
}
