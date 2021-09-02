const { expect } = require("chai");
const { default: wasm_init, HDRHistogram } = require("../pkg/hdr_histogram_wasm");
const { readFile: _readFile } = require("fs");
const { join: joinPath } = require("path");
const { promisify } = require("util");

const  readFile = promisify(_readFile);
const yamlPath = ".";
const statsJsonFile = "stats-test.json";
const histogramTxtFile = "rttHistogram.txt";

describe("config-wasm", () => {
  let histogram;
  let statsJson;
  let histogramTxt;

  before(async () => {
    try {
      // await wasm_init();
      statsJson = await readFile(joinPath(yamlPath, statsJsonFile), "utf8");
      histogramTxt = await readFile(joinPath(yamlPath, histogramTxtFile), "utf8");
    } catch (error) {
      console.error("before error", error);
      throw error;
    }
  });

  afterEach(() => {
    if (histogram) {
      histogram.free();
    }
    histogram = undefined;
  });

  it("should load Histogram", (done) => {
    try {
      histogram = new HDRHistogram(histogramTxt);
      expect(histogram.getMean(), "getMean").to.equal(315165.65853658534);
      expect(histogram.getStdDeviation(), "getStdDeviation").to.equal(213598.47447007187);
      expect(histogram.getTotalCount(), "getTotalCount").to.equal(820n);
      expect(histogram.getMinNonZeroValue(), "getMinNonZeroValue").to.equal(123328n);
      expect(histogram.getMaxValue(), "getMaxValue").to.equal(858111n);
      done();
    } catch (error) {
      console.error("test error", error);
      done(error);
    }
  });

  it("should load all Histogram", (done) => {
    try {
      const re = /rttHistogram":"([^"]+)"/g;
      let rttHistograms = re.exec(statsJson);
      let iteration = 0;
      while (rttHistograms && rttHistograms.length > 1) {
        histogram = new HDRHistogram(rttHistograms[1]);
        expect(histogram.getMean(), "getMean").to.be.greaterThan(0);
        expect(histogram.getStdDeviation(), "getStdDeviation").to.not.equal(undefined);
        expect(histogram.getTotalCount(), "getTotalCount").to.not.equal(undefined);
        expect(histogram.getMinNonZeroValue(), "getMinNonZeroValue").to.not.equal(undefined);
        expect(histogram.getMaxValue(), "getMaxValue").to.not.equal(undefined);

        rttHistograms = re.exec(statsJson);
        iteration++;
      } while (rttHistograms);
      expect(iteration, "histograms found").to.equal(22);
      done();
    } catch (error) {
      console.error("test error", error);
      done(error);
    }
  });
});
