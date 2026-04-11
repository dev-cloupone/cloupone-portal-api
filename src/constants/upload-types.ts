export const UPLOAD_TYPES = ['tickets', 'expenses'] as const;

export type UploadType = (typeof UPLOAD_TYPES)[number];

export function isValidUploadType(value: string): value is UploadType {
  return (UPLOAD_TYPES as readonly string[]).includes(value);
}
