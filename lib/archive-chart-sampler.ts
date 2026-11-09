import type { Telemetry } from "./telemetry";

// Preserve every reading during a short test. After 300 records, thin
// chronologically in a bounded, deterministic single pass (no second Redis scan).
export const MAX_CHART_POINTS = 300;

type IndexedReading = { index: number; reading: Telemetry };
export class ArchiveChartSampler {
  private points: IndexedReading[] = [];
  private stride = 1;
  private count = 0;
  private latest: IndexedReading | null = null;

  add(reading: Telemetry) {
    const entry: IndexedReading = { index: this.count++, reading };
    this.latest = entry;
    if (entry.index % this.stride === 0) this.points.push(entry);
    if (this.points.length > MAX_CHART_POINTS) {
      this.stride *= 2;
      this.points = this.points.filter(point => point.index % this.stride === 0);
    }
  }

  finish() {
    const result = [...this.points];
    const last = this.latest;
    // Include the newest reading, even when downsampling long histories.
    if (last && result[result.length - 1]?.index !== last.index) {
      if (result.length >= MAX_CHART_POINTS) result.pop();
      result.push(last);
    }
    return {
      history: result.map(point => point.reading),
      total: this.count,
      // Spacing is an approximate sampling stride, not a fixed time bucket.
      chartBucketSeconds: this.stride * 10,
      sampled: this.stride > 1
    };
  }
}
