import { windowsColorRef } from "./windows_window_background.ts";

Deno.test("desktop background converts CSS RGB to a Windows COLORREF", () => {
  const color = windowsColorRef(0x09, 0x0c, 0x10);
  if (color !== 0x00100c09) {
    throw new Error(`Unexpected COLORREF: 0x${color.toString(16)}`);
  }
});

Deno.test("desktop background rejects invalid RGB components", () => {
  let rejected = false;
  try {
    windowsColorRef(9, -1, 16);
  } catch (error) {
    rejected = error instanceof RangeError;
  }
  if (!rejected) throw new Error("Invalid RGB component was accepted");
});
