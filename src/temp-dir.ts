import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export const createTempDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "lore-js-sdk-test-"));

export const cleanTempDir = (tempDir: string) => {
  try {
    fs.rmSync(tempDir, {
      recursive: true,
      maxRetries: 3,
      retryDelay: 500,
      force: true,
    });
  } catch (e) {
    console.error("Failed to remove temporary directory", tempDir, e);
  }
};
