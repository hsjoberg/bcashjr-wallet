const LAUFEY_WINDOW_CLASS = "LaufeyWebView2";
const GCLP_HBRBACKGROUND = -10;
const DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
const DWMWA_BORDER_COLOR = 34;
const DWMWA_CAPTION_COLOR = 35;
const DWMWA_TEXT_COLOR = 36;

export interface WindowsWindowAppearanceResult {
  clientBackground: boolean;
  titleBar: boolean;
}

function wideString(value: string): Uint16Array {
  const encoded = new Uint16Array(value.length + 1);
  for (let index = 0; index < value.length; index += 1) {
    encoded[index] = value.charCodeAt(index);
  }
  return encoded;
}

export function windowsColorRef(red: number, green: number, blue: number): number {
  for (const component of [red, green, blue]) {
    if (!Number.isInteger(component) || component < 0 || component > 255) {
      throw new RangeError("Windows RGB components must be integers from 0 through 255");
    }
  }
  return red | (green << 8) | (blue << 16);
}

/**
 * Replaces Laufey's system-colored Win32 class brush with the app background
 * and gives the DWM-owned title bar matching dark colors. WebView2 briefly
 * exposes the native parent while its bounds catch up during interactive
 * resizing, so neither surface can be styled by CSS.
 */
export async function setWindowsWindowAppearance(
  red: number,
  green: number,
  blue: number,
): Promise<WindowsWindowAppearanceResult> {
  const notApplied = { clientBackground: false, titleBar: false };
  if (Deno.build.os !== "windows") return notApplied;

  const user32 = Deno.dlopen(
    "user32.dll",
    {
      FindWindowExW: {
        parameters: ["pointer", "pointer", "pointer", "pointer"],
        result: "pointer",
      },
      GetWindowThreadProcessId: {
        parameters: ["pointer", "buffer"],
        result: "u32",
      },
      SetClassLongPtrW: {
        parameters: ["pointer", "i32", "pointer"],
        result: "pointer",
      },
    } as const,
  );
  const gdi32 = Deno.dlopen(
    "gdi32.dll",
    {
      CreateSolidBrush: {
        parameters: ["u32"],
        result: "pointer",
      },
      DeleteObject: {
        parameters: ["pointer"],
        result: "i32",
      },
    } as const,
  );
  const dwmapi = Deno.dlopen(
    "dwmapi.dll",
    {
      DwmSetWindowAttribute: {
        parameters: ["pointer", "u32", "buffer", "u32"],
        result: "i32",
      },
    } as const,
  );

  try {
    const className = wideString(LAUFEY_WINDOW_CLASS);
    const classNamePointer = Deno.UnsafePointer.of(className);
    let previousWindow: Deno.PointerValue = null;
    let walletWindow: Deno.PointerValue = null;

    // The implicit desktop window normally exists before the Deno runtime
    // starts. Retry briefly as protection against a backend timing change.
    for (let attempt = 0; attempt < 20 && walletWindow === null; attempt += 1) {
      while (true) {
        const candidate = user32.symbols.FindWindowExW(
          null,
          previousWindow,
          classNamePointer,
          null,
        );
        if (candidate === null) break;

        const processId = new Uint32Array(1);
        user32.symbols.GetWindowThreadProcessId(candidate, processId);
        if (processId[0] === Deno.pid) {
          walletWindow = candidate;
          break;
        }
        previousWindow = candidate;
      }

      if (walletWindow === null) {
        previousWindow = null;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }

    if (walletWindow === null) return notApplied;

    const brush = gdi32.symbols.CreateSolidBrush(windowsColorRef(red, green, blue));
    let clientBackground = false;
    if (brush !== null) {
      const previousBrush = user32.symbols.SetClassLongPtrW(
        walletWindow,
        GCLP_HBRBACKGROUND,
        brush,
      );
      if (previousBrush === null) {
        gdi32.symbols.DeleteObject(brush);
      } else {
        clientBackground = true;
      }
    }

    // When applied, the class owns this single brush until process shutdown.
    // Deleting it while Laufey can still paint would leave an invalid handle.

    const darkMode = new Int32Array([1]);
    const captionColor = new Uint32Array([windowsColorRef(red, green, blue)]);
    const textColor = new Uint32Array([windowsColorRef(0xe8, 0xed, 0xf2)]);
    const borderColor = new Uint32Array([windowsColorRef(0x20, 0x27, 0x30)]);
    const darkModeResult = dwmapi.symbols.DwmSetWindowAttribute(
      walletWindow,
      DWMWA_USE_IMMERSIVE_DARK_MODE,
      darkMode,
      darkMode.byteLength,
    );
    const captionResult = dwmapi.symbols.DwmSetWindowAttribute(
      walletWindow,
      DWMWA_CAPTION_COLOR,
      captionColor,
      captionColor.byteLength,
    );
    dwmapi.symbols.DwmSetWindowAttribute(
      walletWindow,
      DWMWA_TEXT_COLOR,
      textColor,
      textColor.byteLength,
    );
    dwmapi.symbols.DwmSetWindowAttribute(
      walletWindow,
      DWMWA_BORDER_COLOR,
      borderColor,
      borderColor.byteLength,
    );

    return {
      clientBackground,
      // Exact caption colors require Windows 11; immersive dark mode remains
      // a useful fallback where the explicit caption attribute is unavailable.
      titleBar: captionResult >= 0 || darkModeResult >= 0,
    };
  } finally {
    dwmapi.close();
    gdi32.close();
    user32.close();
  }
}
