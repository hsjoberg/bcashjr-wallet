export interface AvailableScreenArea {
  availWidth: number;
  availHeight: number;
  availLeft: number;
  availTop: number;
}

export interface DesktopWindowGeometry {
  width: number;
  height: number;
  x: number;
  y: number;
}

const PREFERRED_WIDTH = 1_580;
const PREFERRED_HEIGHT = 1_150;
const HORIZONTAL_WORK_AREA_MARGIN = 32;
const VERTICAL_WORK_AREA_MARGIN = 16;

export function fitWindowToScreen(
  screen: AvailableScreenArea,
  nativeScaleFactor = 1,
): DesktopWindowGeometry | null {
  if (
    !Number.isFinite(screen.availWidth) ||
    !Number.isFinite(screen.availHeight) ||
    !Number.isFinite(screen.availLeft) ||
    !Number.isFinite(screen.availTop) ||
    screen.availWidth < 320 ||
    screen.availHeight < 320 ||
    screen.availWidth > 100_000 ||
    screen.availHeight > 100_000 ||
    Math.abs(screen.availLeft) > 100_000 ||
    Math.abs(screen.availTop) > 100_000 ||
    !Number.isFinite(nativeScaleFactor) ||
    nativeScaleFactor < 0.5 ||
    nativeScaleFactor > 8
  ) return null;

  const availableWidth = Math.floor(screen.availWidth * nativeScaleFactor);
  const availableHeight = Math.floor(screen.availHeight * nativeScaleFactor);
  const availableLeft = Math.round(screen.availLeft * nativeScaleFactor);
  const availableTop = Math.round(screen.availTop * nativeScaleFactor);
  const width = Math.min(
    PREFERRED_WIDTH,
    Math.max(320, availableWidth - HORIZONTAL_WORK_AREA_MARGIN),
  );
  const height = Math.min(
    PREFERRED_HEIGHT,
    Math.max(320, availableHeight - VERTICAL_WORK_AREA_MARGIN),
  );

  return {
    width,
    height,
    x: Math.round(availableLeft + (availableWidth - width) / 2),
    y: Math.round(availableTop + (availableHeight - height) / 2),
  };
}
