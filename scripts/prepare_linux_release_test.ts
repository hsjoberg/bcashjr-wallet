import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findSquashfsOffset, prepareLinuxAppImage } from "./prepare_linux_release.ts";

const decoder = new TextDecoder();
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const appRunTemplate = join(projectRoot, "linux", "AppRun");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function expectRejects(operation: () => Promise<unknown>, expected: string): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expected)) {
      throw new Error(`Expected error containing ${JSON.stringify(expected)}, got: ${message}`);
    }
    return;
  }
  throw new Error(`Expected operation to reject with ${JSON.stringify(expected)}`);
}

async function run(command: string, args: string[]): Promise<Uint8Array> {
  const result = await new Deno.Command(command, {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) {
    throw new Error(`${command} failed: ${decoder.decode(result.stderr)}`);
  }
  return result.stdout;
}

async function runLauncher(
  directory: string,
  environment: Record<string, string>,
  args: string[] = [],
): Promise<{ code: number; output: string; pid: number }> {
  const child = new Deno.Command(join(directory, "AppRun"), {
    args,
    clearEnv: true,
    env: { PATH: "/usr/bin:/bin", ...environment },
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const pid = child.pid;
  const output = await child.output();
  return { code: output.code, output: decoder.decode(output.stdout), pid };
}

Deno.test({
  name: "Linux AppRun selects XWayland safely and preserves process behavior",
  ignore: Deno.build.os === "windows",
  async fn() {
    const directory = await Deno.makeTempDir({ prefix: "bcashjr-apprun-test-" });
    try {
      await Deno.copyFile(appRunTemplate, join(directory, "AppRun"));
      await Deno.chmod(join(directory, "AppRun"), 0o755);
      await Deno.writeTextFile(
        join(directory, "bcashjr-wallet"),
        `#!/bin/sh
if [ "\${WAIT_FOR_SIGNAL:-}" = 1 ]; then
  trap 'exit 42' TERM
  printf ready
  while :; do sleep 1; done
fi
printf 'pid=%s\\n' "$$"
printf 'backend=%s\\n' "\${GDK_BACKEND-unset}"
printf 'argc=%s\\n' "$#"
for argument do printf 'arg=%s\\n' "$argument"; done
exit "\${FAKE_EXIT_CODE:-0}"
`,
        { mode: 0o755 },
      );
      await Deno.chmod(join(directory, "bcashjr-wallet"), 0o755);

      const wayland = await runLauncher(
        directory,
        { WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":1" },
        ["argument with spaces", "--flag"],
      );
      assert(wayland.code === 0, `Unexpected Wayland launcher status: ${wayland.code}`);
      assert(
        wayland.output.includes(`pid=${wayland.pid}\n`),
        "AppRun did not exec the application",
      );
      assert(wayland.output.includes("backend=x11\n"), "Wayland launch did not select X11");
      assert(
        wayland.output.includes("argc=2\narg=argument with spaces\narg=--flag\n"),
        `Arguments were not preserved: ${wayland.output}`,
      );

      const inheritedWayland = await runLauncher(directory, {
        WAYLAND_DISPLAY: "wayland-0",
        DISPLAY: ":1",
        GDK_BACKEND: "wayland",
        FAKE_EXIT_CODE: "23",
      });
      assert(inheritedWayland.code === 23, "Child exit status was not preserved");
      assert(
        inheritedWayland.output.includes("backend=x11\n"),
        "A globally exported Wayland backend bypassed the workaround",
      );

      const nativeWaylandOptIn = await runLauncher(directory, {
        WAYLAND_DISPLAY: "wayland-0",
        DISPLAY: ":1",
        GDK_BACKEND: "wayland",
        BCASHJR_NATIVE_WAYLAND: "1",
      });
      assert(
        nativeWaylandOptIn.output.includes("backend=wayland\n"),
        "AppRun ignored the native Wayland opt-in",
      );

      const nativeX11 = await runLauncher(directory, { DISPLAY: ":0" });
      assert(nativeX11.output.includes("backend=unset\n"), "Native X11 launch injected a backend");

      const waylandOnly = await runLauncher(directory, { WAYLAND_DISPLAY: "wayland-0" });
      assert(
        waylandOnly.output.includes("backend=unset\n"),
        "Wayland-only launch selected an unreachable X11 backend",
      );

      const signalled = new Deno.Command(join(directory, "AppRun"), {
        clearEnv: true,
        env: { PATH: "/usr/bin:/bin", WAIT_FOR_SIGNAL: "1" },
        stdout: "piped",
        stderr: "null",
      }).spawn();
      const reader = signalled.stdout.getReader();
      const ready = await reader.read();
      assert(decoder.decode(ready.value) === "ready", "Signal fixture did not become ready");
      signalled.kill("SIGTERM");
      const status = await signalled.status;
      await reader.cancel();
      assert(status.code === 42, "AppRun did not pass SIGTERM to the executed application");
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
});

Deno.test("SquashFS offset detection rejects non-AppImage data", () => {
  const bytes = new Uint8Array(256);
  bytes.set([0x68, 0x73, 0x71, 0x73], 32);
  try {
    findSquashfsOffset(bytes);
  } catch (error) {
    assert(String(error).includes("found 0"), `Unexpected validation error: ${error}`);
    return;
  }
  throw new Error("Invalid SquashFS header was accepted");
});

Deno.test("Linux AppImage preparation reports a missing artifact", async () => {
  const directory = await Deno.makeTempDir({ prefix: "bcashjr-appimage-missing-" });
  try {
    await expectRejects(
      () => prepareLinuxAppImage(join(directory, "missing.AppImage"), appRunTemplate),
      "Linux AppImage was not found",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test({
  name: "Linux AppImage preparation replaces AppRun and is idempotent",
  ignore: Deno.build.os !== "linux",
  async fn() {
    const directory = await Deno.makeTempDir({ prefix: "bcashjr-appimage-test-" });
    try {
      const appDirectory = join(directory, "app-dir");
      const payload = join(directory, "payload.squashfs");
      const appImage = join(directory, "bcashjr-wallet.AppImage");
      const secondAppImage = join(directory, "bcashjr-wallet-second.AppImage");
      await Deno.mkdir(appDirectory);
      await Deno.writeTextFile(join(appDirectory, "AppRun"), "#!/bin/sh\nexit 1\n", {
        mode: 0o755,
      });
      await Deno.writeTextFile(join(appDirectory, "bcashjr-wallet"), "fixture", { mode: 0o755 });
      await run("mksquashfs", [
        appDirectory,
        payload,
        "-noappend",
        "-no-progress",
        "-comp",
        "zstd",
        "-root-mode",
        "000",
      ]);

      const runtimePrefix = new Uint8Array(4_096).fill(0xa5);
      runtimePrefix.set([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00, 0x41, 0x49]);
      await Deno.writeFile(appImage, runtimePrefix, { mode: 0o755 });
      await Deno.writeFile(appImage, await Deno.readFile(payload), { append: true });
      await Deno.copyFile(appImage, secondAppImage);

      await prepareLinuxAppImage(appImage, appRunTemplate);
      const preparedOnce = await Deno.readFile(appImage);
      await prepareLinuxAppImage(secondAppImage, appRunTemplate);
      assert(
        bytesEqual(await Deno.readFile(secondAppImage), preparedOnce),
        "Identical inputs did not produce identical AppImages",
      );
      const offset = findSquashfsOffset(preparedOnce);
      assert(
        offset === runtimePrefix.length,
        `Runtime prefix moved from ${runtimePrefix.length} to ${offset}`,
      );
      assert(
        bytesEqual(preparedOnce.slice(0, offset), runtimePrefix),
        "Runtime prefix contents changed",
      );
      const packagedAppRun = await run("unsquashfs", [
        "-cat",
        "-o",
        String(offset),
        appImage,
        "AppRun",
      ]);
      assert(
        bytesEqual(packagedAppRun, await Deno.readFile(appRunTemplate)),
        "Packaged AppRun does not match its template",
      );

      const extracted = join(directory, "prepared-root");
      await run("unsquashfs", ["-no-progress", "-d", extracted, "-o", String(offset), appImage]);
      const mode = (await Deno.stat(join(extracted, "AppRun"))).mode ?? 0;
      assert((mode & 0o111) === 0o111, `Packaged AppRun is not executable: ${mode.toString(8)}`);

      await prepareLinuxAppImage(appImage, appRunTemplate);
      assert(
        bytesEqual(await Deno.readFile(appImage), preparedOnce),
        "Repeated preparation changed the AppImage",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
});

Deno.test("desktop and release builds apply the Linux AppImage preparation", async () => {
  const config = JSON.parse(await Deno.readTextFile(join(projectRoot, "deno.json"))) as {
    tasks?: { desktop?: string };
  };
  assert(
    config.tasks?.desktop?.includes("scripts/prepare_linux_release.ts"),
    "The local desktop task bypasses Linux AppImage preparation",
  );

  const workflow = await Deno.readTextFile(
    join(projectRoot, ".github", "workflows", "release.yml"),
  );
  const buildStep = workflow.indexOf("- name: Build desktop package");
  const prepareStep = workflow.indexOf("- name: Apply Linux Wayland compatibility launcher");
  const packageStep = workflow.indexOf("- name: Package Linux artifact");
  assert(
    buildStep >= 0 && buildStep < prepareStep,
    "Release preparation does not follow the build",
  );
  assert(prepareStep < packageStep, "Release artifact is copied before AppImage preparation");
  assert(workflow.includes("squashfs-tools"), "CI does not install the required packaging tools");
});
