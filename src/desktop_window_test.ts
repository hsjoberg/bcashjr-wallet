import { fitWindowToScreen } from "./desktop_window.ts";

Deno.test("desktop window uses its preferred size on a large work area", () => {
  const geometry = fitWindowToScreen({
    availWidth: 2_560,
    availHeight: 2_160,
    availLeft: 0,
    availTop: 0,
  });

  if (
    !geometry || geometry.width !== 1_650 || geometry.height !== 1_150 ||
    geometry.x !== 455 || geometry.y !== 505
  ) throw new Error(`Unexpected geometry: ${JSON.stringify(geometry)}`);
});

Deno.test("desktop window converts a scaled Windows work area to native pixels", () => {
  const geometry = fitWindowToScreen({
    availWidth: 4_655,
    availHeight: 1_261,
    availLeft: 0,
    availTop: 0,
  }, 1.1);

  if (
    !geometry || geometry.width !== 1_650 || geometry.height !== 1_150 ||
    geometry.x !== 1_735 || geometry.y !== 119
  ) throw new Error(`Unexpected geometry: ${JSON.stringify(geometry)}`);
});

Deno.test("desktop window stays below 1080px on a 1080p work area", () => {
  const geometry = fitWindowToScreen({
    availWidth: 1_920,
    availHeight: 1_040,
    availLeft: 0,
    availTop: 0,
  });

  if (
    !geometry || geometry.width !== 1_650 || geometry.height !== 1_024 ||
    geometry.x !== 135 || geometry.y !== 8
  ) throw new Error(`Unexpected geometry: ${JSON.stringify(geometry)}`);
});

Deno.test("desktop window stays inside a smaller logical-pixel work area", () => {
  const geometry = fitWindowToScreen({
    availWidth: 1_280,
    availHeight: 680,
    availLeft: -1_280,
    availTop: 0,
  });

  if (
    !geometry || geometry.width !== 1_248 || geometry.height !== 664 ||
    geometry.x !== -1_264 || geometry.y !== 8
  ) throw new Error(`Unexpected geometry: ${JSON.stringify(geometry)}`);
});

Deno.test("desktop window ignores invalid screen metrics", () => {
  const geometry = fitWindowToScreen({
    availWidth: Number.NaN,
    availHeight: 1_080,
    availLeft: 0,
    availTop: 0,
  });
  if (geometry !== null) throw new Error("Invalid screen metrics were accepted");
});

Deno.test("desktop build embeds the opaque WebView2 background", async () => {
  const projectRoot = new URL("../", import.meta.url);
  const config = JSON.parse(await Deno.readTextFile(new URL("deno.json", projectRoot))) as {
    tasks?: { desktop?: string };
  };
  if (!config.tasks?.desktop?.includes("--env-file=desktop.env")) {
    throw new Error("Desktop build does not embed desktop.env");
  }
  const environment = await Deno.readTextFile(new URL("desktop.env", projectRoot));
  if (environment.trim() !== "WEBVIEW2_DEFAULT_BACKGROUND_COLOR=FF090C10") {
    throw new Error("WebView2 background must be opaque #090c10");
  }
});
