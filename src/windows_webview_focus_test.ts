import { focusWindowsWebview } from "./windows_webview_focus.ts";

interface NativeScenario {
  missingHost?: boolean;
  missingWebview?: boolean;
  foreignWebview?: boolean;
  focusAlreadyMoved?: boolean;
  attachFails?: boolean;
  sameThread?: boolean;
  setFocusThrows?: boolean;
  kernelLoadThrows?: boolean;
}

function runScenario(scenario: NativeScenario = {}) {
  const foreignHost = Deno.UnsafePointer.create(1n);
  const host = Deno.UnsafePointer.create(2n);
  const webview = Deno.UnsafePointer.create(3n);
  const webviewChild = Deno.UnsafePointer.create(4n);
  const closed: string[] = [];
  const attachments: number[] = [];
  let focused = scenario.focusAlreadyMoved ? webviewChild : host;
  let focusCalls = 0;
  const originalDlopen = Deno.dlopen;
  Deno.dlopen = ((filename: string) => {
    if (filename === "kernel32.dll") {
      if (scenario.kernelLoadThrows) throw new Error("Test library failure");
      return {
        symbols: { GetCurrentThreadId: () => scenario.sameThread ? 20 : 30 },
        close: () => closed.push(filename),
      };
    }
    if (filename !== "user32.dll") throw new Error("Unexpected native library");
    return {
      symbols: {
        FindWindowExW: (
          parent: Deno.PointerValue,
          after: Deno.PointerValue,
          className: Uint16Array,
        ) => {
          const name = String.fromCharCode(...className.subarray(0, -1));
          if (parent === null) {
            if (name !== "LaufeyWebView2") throw new Error("Unexpected host class");
            if (scenario.missingHost) return null;
            // A different instance may precede our own window in Z order.
            return after === null ? foreignHost : after === foreignHost ? host : null;
          }
          if (parent !== host || name !== "Chrome_WidgetWin_0") {
            throw new Error("Must search only inside the owned host");
          }
          return scenario.missingWebview ? null : webview;
        },
        GetWindowThreadProcessId: (window: Deno.PointerValue, pid: Uint32Array) => {
          pid[0] = window === foreignHost || (window === webview && scenario.foreignWebview)
            ? Deno.pid + 1
            : Deno.pid;
          return 20;
        },
        AttachThreadInput: (from: number, to: number, attach: number) => {
          if (from !== 30 || to !== 20) throw new Error("Unexpected input threads");
          attachments.push(attach);
          return scenario.attachFails ? 0 : 1;
        },
        GetFocus: () => focused,
        SetFocus: (target: Deno.PointerValue) => {
          if (target !== webview) throw new Error("Must focus only the owned WebView");
          focusCalls++;
          if (scenario.setFocusThrows) throw new Error("Test focus failure");
          focused = webviewChild;
          return host;
        },
        IsChild: (parent: Deno.PointerValue, child: Deno.PointerValue) =>
          parent === webview && child === webviewChild ? 1 : 0,
      },
      close: () => closed.push(filename),
    };
  }) as unknown as typeof Deno.dlopen;
  let result = false;
  let error: unknown;
  try {
    result = focusWindowsWebview();
  } catch (caught) {
    error = caught;
  } finally {
    Deno.dlopen = originalDlopen;
  }
  const expectedClosed = scenario.kernelLoadThrows ? "user32.dll" : "kernel32.dll,user32.dll";
  if (closed.join() !== expectedClosed) throw new Error("Native libraries were not closed");
  return { result, error, attachments, focusCalls };
}

function windowsTest(name: string, fn: () => void) {
  Deno.test({ name, ignore: Deno.build.os !== "windows", fn });
}

windowsTest("Windows startup transfers host focus into its own WebView", () => {
  const outcome = runScenario();
  if (!outcome.result || outcome.error || outcome.focusCalls !== 1) {
    throw new Error("Focus was not handed to WebView2");
  }
  if (outcome.attachments.join() !== "1,0") throw new Error("Input queues were not detached");
});

windowsTest("Windows startup leaves an already-focused child alone", () => {
  const outcome = runScenario({ focusAlreadyMoved: true });
  if (outcome.error || outcome.result || outcome.focusCalls) {
    throw new Error("Existing focus must be preserved");
  }
  if (outcome.attachments.join() !== "1,0") throw new Error("Input queues were not detached");
});

windowsTest("Windows focus skips absent or foreign native windows", () => {
  for (
    const scenario of [
      { missingHost: true },
      { missingWebview: true },
      { foreignWebview: true },
    ]
  ) {
    const outcome = runScenario(scenario);
    if (outcome.error || outcome.result || outcome.focusCalls || outcome.attachments.length) {
      throw new Error("Missing or foreign windows must not receive focus");
    }
  }
});

windowsTest("Windows focus does nothing if input queues cannot be attached", () => {
  const outcome = runScenario({ attachFails: true });
  if (outcome.error || outcome.result || outcome.focusCalls || outcome.attachments.join() !== "1") {
    throw new Error("Failed thread attachment must stop the handoff");
  }
});

windowsTest("Windows focus does not attach a thread to itself", () => {
  const outcome = runScenario({ sameThread: true });
  if (outcome.error || !outcome.result || outcome.focusCalls !== 1 || outcome.attachments.length) {
    throw new Error("Same-thread handoff should not attach input queues");
  }
});

windowsTest("Windows focus detaches input queues even when the handoff fails", () => {
  const outcome = runScenario({ setFocusThrows: true });
  if (!(outcome.error instanceof Error) || outcome.attachments.join() !== "1,0") {
    throw new Error("Failure must still detach input queues");
  }
});

windowsTest("Windows focus closes user32 when loading kernel32 fails", () => {
  const outcome = runScenario({ kernelLoadThrows: true });
  if (!(outcome.error instanceof Error)) throw new Error("Expected library load failure");
});

Deno.test({
  name: "WebView focus handoff is a no-op outside Windows",
  ignore: Deno.build.os === "windows",
  fn: () => {
    if (focusWindowsWebview()) throw new Error("Non-Windows focus behavior must be unchanged");
  },
});
