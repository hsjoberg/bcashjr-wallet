import { join } from "node:path";
import { fileURLToPath } from "node:url";

const APP_NAME = "BcashJr Wallet";
const AD_HOC_IDENTITY = "-";

async function run(command: string, args: string[]): Promise<void> {
  const child = new Deno.Command(command, {
    args,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const status = await child.status;
  if (!status.success) {
    throw new Error(`${command} exited with status ${status.code}`);
  }
}

if (Deno.build.os === "darwin") {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const outputApp = join(projectRoot, "dist", "desktop", `${APP_NAME}.app`);
  const outputDmg = join(projectRoot, "dist", "desktop", `${APP_NAME}.dmg`);
  const entitlements = join(projectRoot, "macos", "entitlements.plist");
  const signingIdentity = Deno.env.get("MACOS_CODESIGN_IDENTITY")?.trim() || AD_HOC_IDENTITY;
  const distributionBuild = signingIdentity !== AD_HOC_IDENTITY;
  // Hardened Runtime validates that loaded libraries share the host's Team ID. Ad-hoc signatures
  // have no Team ID, so enable it only when every component is signed with Developer ID.
  const hardenedRuntimeArgs = distributionBuild ? ["--timestamp", "--options", "runtime"] : [];
  const runtimeLibrary = join(outputApp, "Contents", "MacOS", "libruntime.dylib");
  const temporaryRoot = await Deno.makeTempDir({ prefix: "bcashjr-macos-release-" });
  const stagedVolume = join(temporaryRoot, "volume");
  const stagedApp = join(stagedVolume, `${APP_NAME}.app`);
  const replacementDmg = join(temporaryRoot, `${APP_NAME}.dmg`);

  try {
    await Deno.mkdir(stagedVolume);

    await run("codesign", [
      "--force",
      ...hardenedRuntimeArgs,
      "--sign",
      signingIdentity,
      runtimeLibrary,
    ]);
    await run("codesign", [
      "--force",
      ...hardenedRuntimeArgs,
      "--entitlements",
      entitlements,
      "--sign",
      signingIdentity,
      outputApp,
    ]);
    await run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", outputApp]);

    await run("ditto", [outputApp, stagedApp]);
    await Deno.symlink("/Applications", join(stagedVolume, "Applications"));

    await run("hdiutil", [
      "create",
      "-quiet",
      "-volname",
      APP_NAME,
      "-srcfolder",
      stagedVolume,
      "-fs",
      "APFS",
      "-format",
      "UDZO",
      replacementDmg,
    ]);
    if (distributionBuild) {
      await run("codesign", [
        "--force",
        "--timestamp",
        "--sign",
        signingIdentity,
        replacementDmg,
      ]);
      await run("codesign", ["--verify", "--strict", "--verbose=2", replacementDmg]);
    }

    await Deno.rename(replacementDmg, outputDmg);
    const signingKind = distributionBuild ? "Developer ID-signed" : "ad-hoc signed";
    console.log(`Created ${signingKind} macOS app: ${outputApp}`);
    console.log(`Created macOS disk image: ${outputDmg}`);
  } finally {
    await Deno.remove(temporaryRoot, { recursive: true });
  }
}
