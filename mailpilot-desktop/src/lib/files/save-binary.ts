import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

export type SaveBinaryFilter = {
  name: string;
  extensions: string[];
};

type SaveBinaryWithDialogOptions = {
  defaultFileName: string;
  bytes: Uint8Array;
  filters?: SaveBinaryFilter[];
};

export async function saveBinaryWithDialog(
  options: SaveBinaryWithDialogOptions,
): Promise<string | null> {
  const savePath = await save({
    defaultPath: options.defaultFileName,
    filters: options.filters,
  });

  if (!savePath) {
    return null;
  }

  await writeFile(savePath, options.bytes);
  return savePath;
}
