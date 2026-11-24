export const MAX_DRAWING_FILE_MB = 50;
export const MAX_DRAWING_FILE_BYTES = MAX_DRAWING_FILE_MB * 1024 * 1024;

export const exceedsDrawingFileLimit = (size: number): boolean => size > MAX_DRAWING_FILE_BYTES;