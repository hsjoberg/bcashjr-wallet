function wideString(value: string): Uint16Array {
  return new Uint16Array([...value, "\0"].map((character) => character.charCodeAt(0)));
}

/**
 * Laufey's Windows focus() targets the outer HWND, not WebView2. Hand off
 * that focus after the page is ready, before React mounts its autofocus input.
 * Never change focus if it has already moved to a child or another window.
 */
export function focusWindowsWebview(): boolean {
  if (Deno.build.os !== "windows") return false;

  const user32 = Deno.dlopen(
    "user32.dll",
    {
      FindWindowExW: {
        parameters: ["pointer", "pointer", "buffer", "pointer"],
        result: "pointer",
      },
      GetWindowThreadProcessId: { parameters: ["pointer", "buffer"], result: "u32" },
      AttachThreadInput: { parameters: ["u32", "u32", "i32"], result: "i32" },
      GetFocus: { parameters: [], result: "pointer" },
      SetFocus: { parameters: ["pointer"], result: "pointer" },
      IsChild: { parameters: ["pointer", "pointer"], result: "i32" },
    } as const,
  );
  try {
    const kernel32 = Deno.dlopen(
      "kernel32.dll",
      {
        GetCurrentThreadId: { parameters: [], result: "u32" },
      } as const,
    );
    try {
      const hostClass = wideString("LaufeyWebView2");
      const processId = new Uint32Array(1);
      let host: Deno.PointerValue = null;
      let hostThread: number;
      do {
        host = user32.symbols.FindWindowExW(null, host, hostClass, null);
        if (host === null) return false;
        hostThread = user32.symbols.GetWindowThreadProcessId(host, processId);
      } while (processId[0] !== Deno.pid);

      // Only use the embedded WebView belonging to this app, not another
      // browser or desktop window. A changed native hierarchy is a no-op.
      const webview = user32.symbols.FindWindowExW(
        host,
        null,
        wideString("Chrome_WidgetWin_0"),
        null,
      );
      if (webview === null) return false;
      const webviewThread = user32.symbols.GetWindowThreadProcessId(webview, processId);
      if (processId[0] !== Deno.pid || !hostThread || webviewThread !== hostThread) return false;

      // Deno runs separately from the native UI thread. Temporarily join
      // their input queues so GetFocus/SetFocus operate on the host's queue.
      const currentThread = kernel32.symbols.GetCurrentThreadId();
      const needsAttach = currentThread !== hostThread;
      if (
        needsAttach && !user32.symbols.AttachThreadInput(currentThread, hostThread, 1)
      ) return false;
      try {
        if (!Deno.UnsafePointer.equals(user32.symbols.GetFocus(), host)) return false;
        user32.symbols.SetFocus(webview);
        const focused = user32.symbols.GetFocus();
        return Deno.UnsafePointer.equals(focused, webview) ||
          user32.symbols.IsChild(webview, focused) !== 0;
      } finally {
        if (needsAttach) user32.symbols.AttachThreadInput(currentThread, hostThread, 0);
      }
    } finally {
      kernel32.close();
    }
  } finally {
    user32.close();
  }
}
