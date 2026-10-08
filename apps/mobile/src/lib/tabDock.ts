export function dockPosition(position: number, count: number): number {
  return Math.max(0, Math.min(count - 1, position));
}

export function dockIndex(position: number, count: number): number {
  return Math.round(dockPosition(position, count));
}

export function dockTouchPosition(pageX: number, left: number, width: number, count: number): number {
  const slot = (width - 8) / count;
  return slot > 0 ? dockPosition((pageX - left - 4) / slot - 0.5, count) : 0;
}
