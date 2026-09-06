import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SQUASHFS_MAGIC = new Uint8Array([0x68, 0x73, 0x71, 0x73]);
const SQUASHFS_HEADER_SIZE = 96;
const SQUASHFS_MAJOR_OFFSET = 28;
const SQUASHFS_MINOR_OFFSET = 30;
const SQUASHFS_BLOCK_SIZE_OFFSET = 12;

const decoder = new TextDecoder();

async function run(
  command: string,
  args: string[],
): Promise<Uint8Array> {
  let result: Deno.CommandOutput;
  try {
    result = await new Deno.Command(command, {
      args,
      stdout: "piped",
      stderr: "piped",
    }).output();
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        `Required command '${command}' was not found. Install squashfs-tools and retry.`,
        { cause: error },
      );
    }
    throw error;
  }

  if (!result.success) {
    const stderr = decoder.decode(result.stderr).trim();
    throw new Error(
      `${command} ${args.join(" ")} exited with status ${result.code}${
        stderr ? `: ${stderr}` : ""
      }`,
    );
  }
  return result.stdout;
}

function uint16LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function uint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)) >>> 0;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isSquashfsHeader(bytes: Uint8Array, offset: number): boolean {
  if (offset + SQUASHFS_HEADER_SIZE > bytes.length) return false;
  for (let index = 0; index < SQUASHFS_MAGIC.length; index++) {
    if (bytes[offset + index] !== SQUASHFS_MAGIC[index]) return false;
  }

  const blockSize = uint32LittleEndian(bytes, offset + SQUASHFS_BLOCK_SIZE_OFFSET);
  return uint16LittleEndian(bytes, offset + SQUASHFS_MAJOR_OFFSET) === 4 &&
    uint16LittleEndian(bytes, offset + SQUASHFS_MINOR_OFFSET) === 0 &&
    blockSize >= 4_096 && blockSize <= 1_048_576 && (blockSize & (blockSize - 1)) === 0;
}

export function findSquashfsOffset(bytes: Uint8Array): number {
  const candidates: number[] = [];
  for (let offset = 0; offset <= bytes.length - SQUASHFS_HEADER_SIZE; offset++) {
    if (bytes[offset] === SQUASHFS_MAGIC[0] && isSquashfsHeader(bytes, offset)) {
      candidates.push(offset);
    }
  }
  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one SquashFS payload, found ${candidates.length}.`,
    );
  }
  return candidates[0];
}

async function setFixedTimestamps(path: string): Promise<void> {
  const directories: string[] = [];
  for await (const entry of Deno.readDir(path)) {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory) {
      await setFixedTimestamps(entryPath);
      directories.push(entryPath);
    } else if (!entry.isSymlink) {
      await Deno.utime(entryPath, 0, 0);
    }
  }
  for (const directory of directories) await Deno.utime(directory, 0, 0);
  await Deno.utime(path, 0, 0);
}

async function extractAppImage(
  appImagePath: string,
  squashfsOffset: number,
  destination: string,
): Promise<void> {
  await run("unsquashfs", [
    "-no-progress",
    "-d",
    destination,
    "-o",
    String(squashfsOffset),
    appImagePath,
  ]);
  // Some AppImage builders store the SquashFS root with mode 000. FUSE can
  // still mount that image, but unsquashfs faithfully applies the mode to the
  // extraction directory, making its contents inaccessible to this process.
  await Deno.chmod(destination, 0o755);
}

async function makeTreeRemovable(path: string): Promise<void> {
  let info: Deno.FileInfo;
  try {
    info = await Deno.lstat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  if (!info.isDirectory) return;

  await Deno.chmod(path, ((info.mode ?? 0) & 0o777) | 0o700);
  for await (const entry of Deno.readDir(path)) {
    if (entry.isDirectory && !entry.isSymlink) {
      await makeTreeRemovable(join(path, entry.name));
    }
  }
}

async function verifyAppImage(appImagePath: string, expectedAppRun: Uint8Array): Promise<void> {
  const image = await Deno.readFile(appImagePath);
  const offset = findSquashfsOffset(image);
  await run("unsquashfs", ["-s", "-o", String(offset), appImagePath]);
  const packagedAppRun = await run("unsquashfs", [
    "-cat",
    "-o",
    String(offset),
    appImagePath,
    "AppRun",
  ]);
  if (!bytesEqual(packagedAppRun, expectedAppRun)) {
    throw new Error("The rebuilt AppImage does not contain the expected AppRun.");
  }
}

export async function prepareLinuxAppImage(
  appImagePath: string,
  appRunTemplatePath: string,
): Promise<void> {
  const originalImage = await Deno.readFile(appImagePath).catch((error) => {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`Linux AppImage was not found: ${appImagePath}`, { cause: error });
    }
    throw error;
  });
  const originalOffset = findSquashfsOffset(originalImage);
  const originalRuntime = originalImage.slice(0, originalOffset);
  const expectedAppRun = await Deno.readFile(appRunTemplatePath);
  const outputDirectory = dirname(appImagePath);
  const temporaryRoot = await Deno.makeTempDir({
    dir: outputDirectory,
    prefix: "bcashjr-linux-release-",
  });
  const extractedRoot = join(temporaryRoot, "squashfs-root");
  const squashfsPath = join(temporaryRoot, "payload.squashfs");
  const replacementPath = join(temporaryRoot, "bcashjr-wallet.AppImage");

  try {
    await extractAppImage(appImagePath, originalOffset, extractedRoot);
    const extractedAppRunPath = join(extractedRoot, "AppRun");
    const currentAppRun = await Deno.readFile(extractedAppRunPath);
    if (bytesEqual(currentAppRun, expectedAppRun)) {
      await verifyAppImage(appImagePath, expectedAppRun);
      console.log(`Linux AppImage already contains the compatibility launcher: ${appImagePath}`);
      return;
    }

    await Deno.writeFile(extractedAppRunPath, expectedAppRun, { mode: 0o755 });
    await Deno.chmod(extractedAppRunPath, 0o755);
    await setFixedTimestamps(extractedRoot);
    await run("mksquashfs", [
      extractedRoot,
      squashfsPath,
      "-noappend",
      "-comp",
      "zstd",
      "-no-progress",
      "-all-root",
      "-no-xattrs",
      "-no-exports",
      "-mkfs-time",
      "0",
    ]);

    await Deno.writeFile(replacementPath, originalRuntime, { mode: 0o755 });
    await Deno.writeFile(replacementPath, await Deno.readFile(squashfsPath), { append: true });
    await Deno.chmod(replacementPath, 0o755);

    const rebuiltImage = await Deno.readFile(replacementPath);
    const rebuiltOffset = findSquashfsOffset(rebuiltImage);
    if (
      rebuiltOffset !== originalOffset ||
      !originalRuntime.every((value, index) => value === rebuiltImage[index])
    ) {
      throw new Error("The AppImage runtime prefix changed during Linux packaging.");
    }
    await verifyAppImage(replacementPath, expectedAppRun);
    await Deno.rename(replacementPath, appImagePath);
    console.log(`Applied the Linux Wayland compatibility launcher: ${appImagePath}`);
  } finally {
    await makeTreeRemovable(temporaryRoot);
    await Deno.remove(temporaryRoot, { recursive: true }).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
  }
}

if (import.meta.main && Deno.build.os === "linux") {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  await prepareLinuxAppImage(
    join(projectRoot, "dist", "linux", "bcashjr-wallet.AppImage"),
    join(projectRoot, "linux", "AppRun"),
  );
}
