// Mock HDR Histogram for testing
export class Histogram {
  constructor() {
    this.values = [];
  }

  getTotalCount() {
    return this.values.length;
  }

  getValueAtPercentile(percentile) {
    if (this.values.length === 0) return 0;
    const index = Math.floor((percentile / 100) * this.values.length);
    return this.values[index] || 0;
  }

  getMinNonZeroValue() {
    return Math.min(...this.values.filter(v => v > 0)) || 0;
  }

  getMaxValue() {
    return Math.max(...this.values) || 0;
  }

  getMean() {
    if (this.values.length === 0) return 0;
    return this.values.reduce((a, b) => a + b, 0) / this.values.length;
  }

  getStdDeviation() {
    const mean = this.getMean();
    const variance = this.values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / this.values.length;
    return Math.sqrt(variance);
  }

  clone() {
    const cloned = new Histogram();
    cloned.values = [...this.values];
    return cloned;
  }

  free() {
    // No-op for mock
  }
}

export default {
  Histogram
};
