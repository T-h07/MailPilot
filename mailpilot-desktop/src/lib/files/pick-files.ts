import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";

export type PickedFile = {
  path: string;
  fileName: string;
  mimeType: string | null;
  bytes: Uint8Array;
  size: number;
};

const MIME_BY_EXTENSION: Record<string, string> = {
  txt: "text/plain",
  csv: "text/csv",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  json: "application/json",
  xml: "application/xml",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export async function pickFilesForUpload(): Promise<PickedFile[]> {
  const picked = await open({
    multiple: true,
    directory: false,
  });

  if (!picked) {
    return [];
  }

  const paths = Array.isArray(picked) ? picked : [picked];
  const files: PickedFile[] = [];

  for (const path of paths) {
    const bytes = await readFile(path);
    const fileName = extractFileName(path);
    files.push({
      path,
      fileName,
      mimeType: detectMimeType(fileName),
      bytes,
      size: bytes.length,
    });
  }

  return files;
}

function extractFileName(path: string): string {
  const slashIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (slashIndex >= 0) {
    return path.substring(slashIndex + 1);
  }
  return path;
}

function detectMimeType(fileName: string): string | null {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === fileName.length - 1) {
    return null;
  }
  const extension = fileName.substring(dotIndex + 1).toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? null;
}
