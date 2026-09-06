# Linux Wayland black-screen/OOM fix

## Outcome

Make the released Linux AppImage select GTK's X11 backend automatically when it is launched from a
Wayland session with XWayland available. This turns the reporter's proven working command into the
packaged default, prevents the black-screen/OOM failure, and still lets users explicitly opt into
native Wayland. The setting must be applied by the AppImage launcher before GTK is initialized.

## Diagnosis

- The Linux package uses Deno Desktop's `webview` backend, so the generated launcher dynamically
  loads the host's GTK 3 and WebKitGTK 4.1 libraries. The application UI and wallet backend are the
  same when launched under X11 and Wayland.
- The released v0.0.1 AppImage contains an `AppRun` that immediately executes `bcashjr-wallet`. It
  does not establish a WebKit rendering policy first.
- Deno 2.9.6 uses laufey's native Wayland support. The laufey Linux launcher calls `gtk_init()`
  before loading `bcashjr-wallet.so`, so changing `Deno.env` in `main.ts` or adding this setting to
  `desktop.env` happens too late to select GTK/WebKit's renderer.
- The symptom is in the native Wayland rendering path: native Wayland shows a black WebView and the
  process grows until the kernel kills it, while selecting GTK's X11 backend with otherwise
  identical code and data avoids the failure.
- This strongly argues against a React render loop or wallet-state leak: both execute unchanged
  under the working X11 launch. During acceptance testing, confirm from the OOM journal entry that
  the growing process is `WebKitWebProcess` rather than assuming it.
- Disabling DMA-BUF is not a safe default for the WebKitGTK 2.52 family used by Ubuntu 26.04.
  Upstream/application reports disagree across patch levels: `WEBKIT_DISABLE_DMABUF_RENDERER=1` can
  fix older failures but can leave the 2.52 transport mode invalid, while
  `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` has also been observed with a black window and an eventual
  OOM. The implementation should use the workaround verified for this artifact instead of adding an
  unverified renderer variable.

## Implementation

### 1. Own the Linux `AppRun`

Add `linux/AppRun` as a POSIX `sh` launcher template. Before it executes the generated
`bcashjr-wallet` binary, it should:

1. Detect a native Wayland launch using a non-empty `WAYLAND_DISPLAY` and a `GDK_BACKEND` value that
   the caller has not explicitly set. Require a non-empty `DISPLAY` as evidence that XWayland is
   reachable; do not break Wayland-only compositors.
2. Set and export `GDK_BACKEND=x11`. A caller-provided `GDK_BACKEND` must win, so
   `GDK_BACKEND=wayland ./bcashjr-wallet.AppImage` remains available for diagnostics and for a
   future fixed system WebKitGTK.
3. Preserve every command-line argument with `"$@"` and use `exec` so signals and exit codes reach
   the real application.

Do not put the variable in `desktop.env` or `main.ts`: the native launcher has already called
`gtk_init()` before either can take effect.

### 2. Post-process the generated AppImage deterministically

Add `scripts/prepare_linux_release.ts`, following the role of the existing macOS release helper. The
script should:

1. Be a no-op on non-Linux hosts so `deno task desktop` remains portable.
2. Locate `dist/linux/bcashjr-wallet.AppImage` and fail clearly if a Linux build was expected but
   the artifact is absent.
3. Read the original AppImage runtime prefix and extract the SquashFS payload into a temporary
   directory using `unsquashfs`.
4. Replace only the extracted `AppRun` with the repository-owned template and enforce mode `0755`.
5. Rebuild the payload with zstd, root ownership, sorted inputs, and fixed timestamps, then prepend
   the unchanged runtime prefix and atomically replace the artifact.
6. Re-open the rebuilt image with `unsquashfs`, verify its filesystem, and assert that its `AppRun`
   exactly matches the template.

Use the AppImage's SquashFS offset rather than hard-coding the current x86-64 value so a Deno update
cannot silently corrupt the package. Require `squashfs-tools` with an actionable error; install the
pinned Ubuntu package in CI rather than downloading an unverified continuous `appimagetool` binary.

### 3. Wire both build paths

- In `deno.json`, append `deno run --no-config -A scripts/prepare_linux_release.ts` after
  `deno desktop` and before the macOS preparation step.
- In `.github/workflows/release.yml`, install `squashfs-tools` only for the Linux matrix entry and
  run the Linux preparation script immediately after `deno desktop`.
- Keep the current copy/upload/checksum order. The release job will then hash the patched artifact,
  not the pre-patch image.

### 4. Add regression tests

Add tests for the launcher and packager:

- Wayland plus XWayland with no explicit backend exports `GDK_BACKEND=x11`.
- An explicit `GDK_BACKEND=wayland` is preserved.
- A native X11 launch does not inject the workaround.
- A Wayland session without `DISPLAY` is left on native Wayland instead of being made unlaunchable.
- Arguments, spaces, signals, and the child exit status pass through the launcher.
- The post-processor rejects a missing/invalid AppImage, preserves the runtime prefix, creates an
  executable `AppRun`, and is idempotent.
- A release-workflow static test ensures Linux packaging cannot bypass the post-processing step.

### 5. Update support documentation

Replace the README's current manual workaround with the new automatic behavior and a short
troubleshooting section. Document `GDK_BACKEND=wayland` as the opt-in native path and explain that
the compatibility default requires XWayland.

## Validation matrix

Before release, exercise the rebuilt AppImage rather than an unpackaged dev run:

| Environment                                               | Expected result                                                                                             |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Ubuntu 26.04 LTS, affected Wayland machine, normal launch | Runs through XWayland; UI paints immediately; renderer RSS plateaus during a 10-minute idle/interaction run |
| Ubuntu 26.04 LTS, `GDK_BACKEND=wayland`                   | Native path is still selectable and reproduces/exposes the original issue until system WebKitGTK is fixed   |
| Ubuntu 24.04 LTS Wayland                                  | Automatic XWayland path supports UI, focus, resize, QR display, and close lifecycle                         |
| Linux X11/XWayland                                        | No regression; workaround is not injected for a native X11 launch                                           |
| Wayland-only compositor (`DISPLAY` absent)                | Launcher does not force an unavailable backend and reports any native WebKit failure normally               |

Record the main process and `WebKitWebProcess` RSS at launch, two minutes, and ten minutes. Check
the kernel journal for OOM events and WebKit crashes. Run the normal `check`, `lint`, `test`, and UI
build suite before packaging.

## Follow-up and removal

Track the Ubuntu/WebKitGTK fix separately. Remove the XWayland compatibility default only after a
fixed WebKitGTK version is available on every supported Linux baseline and the native path passes
the same black-screen and memory-soak tests. If supporting compositors without XWayland becomes a
release requirement before then, evaluate a Linux-only CEF build; do not silently combine multiple
version-sensitive WebKit renderer environment variables.

## Upstream references

- [Deno Desktop distribution and AppImage packaging](https://docs.deno.com/runtime/desktop/distribution/)
- [Deno native Wayland launcher change](https://github.com/denoland/deno/pull/35485)
- [laufey native Wayland implementation and GTK initialization details](https://github.com/littledivy/laufey/pull/17)
- [WebKitGTK DMA-BUF allocation leak](https://bugs.webkit.org/show_bug.cgi?id=305401)
- [WebKitGTK blank-screen report on NVIDIA/Wayland](https://bugs.webkit.org/show_bug.cgi?id=259644)
- [Ubuntu 26.04 WebKitGTK AppImage OOM report](https://github.com/block/buzz/issues/6272)
- [WebKitGTK 2.52 report where disabling DMA-BUF causes a different crash](https://github.com/block/buzz/issues/3654)
