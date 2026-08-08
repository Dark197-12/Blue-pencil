/** Plot area of the arc sparkline, in the SVG's own user units. */
export const SPARKLINE_WIDTH = 100;
export const SPARKLINE_HEIGHT = 34;

export interface SparklinePoint {
  x: number;
  y: number;
}

/**
 * Maps a series of metric values onto sparkline coordinates.
 *
 * The series is scaled to its own range rather than to zero, because an arc is
 * a claim about change: a rise from 12.0 to 12.4 words per sentence and one
 * from 4 to 30 both need to be visible, and an axis anchored at zero would
 * flatten the first into a straight line.
 *
 * Y is inverted, since SVG counts downward from the top and a rising metric
 * should rise on screen.
 */
export function sparklinePoints(values: ReadonlyArray<number>): SparklinePoint[] {
  if (values.length === 0) return [];

  const low = Math.min(...values);
  const high = Math.max(...values);
  // A flat series has no range to scale by; dividing by it would be NaN, so
  // every point sits on the baseline instead.
  const span = high - low || 1;

  return values.map((value, i) => ({
    // One point has no interval to spread across, so it is centred rather than
    // pinned to the left edge by a division by zero.
    x: values.length === 1 ? SPARKLINE_WIDTH / 2 : (i / (values.length - 1)) * SPARKLINE_WIDTH,
    y: SPARKLINE_HEIGHT - ((value - low) / span) * SPARKLINE_HEIGHT,
  }));
}

/** An SVG path through the points, as `M`/`L` commands. */
export function sparklinePath(points: ReadonlyArray<SparklinePoint>): string {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");
}
