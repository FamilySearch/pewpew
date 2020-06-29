<div>
  {#if buckets.length > 0}
    <div>
      <h1>{testName || "Test"} Summary Data</h1>
      <section>
        <h3>Time Taken</h3>
        <p>{startTime} to {endTime}</p>
        <p>Total time: {deltaTime}</p>
        <h3>Overview charts</h3>
        <p>Filter which endpoints are included in the summary:</p>
        <label>
          <input type="text" multiple on:input={updateSummaryTagFilter} placeholder=""/>
          <span>Tag name</span>
        </label>
        <label>
          <input type="text" multiple on:input={updateSummaryTagValueFilter} placeholder=""/>
          <span>Tag value contains</span>
        </label>
        {#if summaryData.dataPoints.length > 0}
        <Endpoint tags={summaryData.tags} dataPoints={summaryData.dataPoints} />
        {:else}
        <p>No summary data to display</p>
        {/if}
      </section>
      <h1>Endpoint Data</h1>
      <section>
        {#each buckets as [tags, dataPoints]}
          <Endpoint {tags} {dataPoints} />
        {/each}
      </section>
    </div>
  {:else}
    <DropZone on:fileDataParsed={bucketReceive}/>
  {/if}
</div>

<script>
  import DropZone from "./DropZone.svelte";
  import Endpoint from "./Endpoint/Endpoint.svelte";
  import * as model from "../model.ts";

  let buckets = [];

  let summaryTagFilter = "";
  let summaryTagValueFilter = "";

  let startTime, endTime, deltaTime, summaryData, testName;

  $: {
    const allDataPoints = [];
    for (const [tags, dataPoints] of buckets) {
      if (summaryTagFilter && tags[summaryTagFilter] && tags[summaryTagFilter].includes(summaryTagValueFilter) || !summaryTagFilter) {
        allDataPoints.push(...dataPoints);
      }
    }
    const dataPoints = model.mergeAllDataPoints(...allDataPoints);
    let summary;
    if (summaryTagFilter) {
      summary = `Showing only endpoints with a tag of "${summaryTagFilter}"`;
      if (summaryTagValueFilter) {
        summary += ` and a value containing "${summaryTagValueFilter}"`
      }
    } else {
      summary = "Including all endpoints";
    }
    const tags = {};
    summaryData = { tags, dataPoints };
  }

  let lastSummaryTagFilterUpdate;
  function updateSummaryTagFilter(e) {
    clearTimeout(lastSummaryTagFilterUpdate);
    lastSummaryTagFilterUpdate = setTimeout(() => summaryTagFilter = e.target.value, 500);
  }

  let lastSummaryTagValueFilterUpdate;
  function updateSummaryTagValueFilter(e) {
    clearTimeout(lastSummaryTagValueFilterUpdate);
    lastSummaryTagValueFilterUpdate = setTimeout(() => summaryTagValueFilter = e.target.value, 500);
  }

  function bucketReceive(event) {
    buckets = event.detail.buckets;
    testName = event.detail.testName;
    timeReceive();
  }

  function dateToString(date, timeOnly) {
    let string = date.toLocaleTimeString("en-us", { hour12: false });
    if (!timeOnly) {
      string += ` ${date.getDate()}-${date.toLocaleString("en-us", { month: "short" })}-${date.getFullYear()}`;
    }
    return string;
  }

  function timeReceive() {
    let startTime2 = Infinity;
    let endTime2 = -Infinity;

    // iterate through each bucket, to find min start and max end time
    for (let [_, dataPoints] of buckets) {
      // iterate through the points until we get one with a startTime
      for (let point of dataPoints) {
        if (point.startTime) {
          startTime2 = Math.min(startTime2, point.startTime);
          break;
        }
      }
      // iterate through the points in reverse order until we get one with an endTime
      for (let i = dataPoints.length - 1; i >= 0; i--) {
        const point = dataPoints[i];
        if (point.endTime) {
          endTime2 = Math.max(endTime2, point.endTime);
          break;
        }
      }
    }

    const second = 1;
    const minute = 60;
    const hour = minute * 60;
    const day = hour * 24;
    let deltaTimeInSeconds = (endTime2 - startTime2) / 1000;

    startTime2 = new Date(startTime2);
    endTime2 = new Date(endTime2);

    const includeDateWithStart = startTime2.toLocaleDateString() == endTime2.toLocaleDateString();
    startTime = dateToString(startTime2, includeDateWithStart);
    endTime = dateToString(endTime2, false);

    const timeUnits = [
      [day, "day"],
      [hour, "hour"],
      [minute, "minute"],
      [second, "second"],
    ];
    const prettyDurationBuilder = [];
    for (const [unit, name] of timeUnits) {
      const count = Math.floor(deltaTimeInSeconds / unit);
      if (count > 0) {
        deltaTimeInSeconds -= count * unit;
        prettyDurationBuilder.push(`${count} ${name}${count > 1 ? "s" : ""}`);
      }
    }

    deltaTime = prettyDurationBuilder.join(", ");
  }

</script>

<style>
  :root {
    --accent: #bcbcbc;
    --accent2: rgb(0, 116, 232);
    --background: #eee;
    --text: #333;
    background: var(--background);
    color: var(--text);
    font-family: sans-serif;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --accent: #767676;
      --accent2: #353b48;
      --background: #333;
      --text: #eee;
    }
  }
  input {
    background: var(--accent);
    color: var(--text);
    line-height: 1.75em;
  }
  section {
    padding-left: 1em;
  }
  section:not(:last-child) {
    border-bottom: 2px solid;
  }
  label {
    position: relative;
    display: inline-block;
    margin: 1.5em 1em 0 0;
    line-height: 1.75em;
  }
  label > span {
    z-index: 1;
    position: absolute;
    top: 0;
    left: 0.5ex;
    transition: all 200ms;
    user-select: none;
  }
  label > input:not(:placeholder-shown) + span, label > input:focus + span {
    opacity: 1;
    font-size: 75%;
    font-weight: bold;
    top: -100%;
  }
</style>