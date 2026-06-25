// Mock HDR Histogram for testing

export class HDRHistogram {
  constructor(_base64, _logLevel) {
    this._count = BigInt(0);
  }

  getTotalCount() {
    return this._count;
  }

  getValueAtPercentile(_percentile) {
    return BigInt(0);
  }

  getMinNonZeroValue() {
    return BigInt(0);
  }

  getMaxValue() {
    return BigInt(0);
  }

  getMean() {
    return 0;
  }

  getStdDeviation() {
    return 0;
  }

  add(other) {
    this._count += other._count;
  }

  clone() {
    const cloned = new HDRHistogram();
    cloned._count = this._count;
    return cloned;
  }

  free() {
    // No-op for mock
  }
}

// Legacy export kept for backwards compatibility with existing tests
export class Histogram {
  constructor() {
    this.values = [];
  }

  getTotalCount() {
    return this.values.length;
  }

  getValueAtPercentile(percentile) {
    if (this.values.length === 0) { return 0; }
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
    if (this.values.length === 0) { return 0; }
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
  HDRHistogram,
  Histogram
};
