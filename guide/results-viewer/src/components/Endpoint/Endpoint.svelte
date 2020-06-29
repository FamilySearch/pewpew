<div class="endpoint">
  {#if Object.keys(tags).length}
  <h3>Tags</h3>
  <table>
    <tbody>
      {#each Object.entries(tags) as [key, value]}
        <tr>
          <td>{key}</td>
          <td title={value}>{value}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  {/if}
  <div class="flex column center overview">
    <h3 class="align-self-start">Overview</h3>
    <div class="flex row">
      <div class="flex column center margin-right">
        <h4>RTT Stats</h4>
        <table>
          <tbody>
            {#each totalResults.stats as [label, stat]}
              <tr>
                <td>{label}</td>
                <td>{stat.toLocaleString()}ms</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="flex column center margin-right">
        <h4>HTTP Status Counts</h4>
        <table>
          <tbody>
            {#each totalResults.statusCounts as [status, count, percent]}
              <tr>
                <td>{status}</td>
                <td>{count.toLocaleString()}</td>
                <td>{(percent * 100).toFixed(1) + "%"}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if totalResults.otherErrors.length > 0}
      <div class="flex column center">
        <h4>Test Errors and Warnings</h4>
        <table>
          <tbody>
            {#each totalResults.otherErrors as [msg, count]}
              <tr>
                <td title={msg}>{msg}</td>
                <td>{count}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {/if}
    </div>
  </div>
  <div class="flex row">
    <div class="rtt flex column center">
      <h3 class="align-self-start">RTT Stats</h3>
      <button class="align-self-start y-scale" on:click={() => toggleChart(rttChart)} title={`Switch the y-axis to use a ${rttButton} scale`}>
        {yScaleButtonLabel[rttButton]}
      </button>
      <div class="flex row center">
        <div class="canvas-box">
          <canvas bind:this={rttCanvas} />
        </div>
      </div>
    </div>
    <div class="flex column center">
      <h3 class="align-self-start">HTTP Status Counts and Test Errors and Warnings</h3>
      <button class="align-self-start y-scale" on:click={() => toggleChart(totalChart)} title={`Switch the y-axis to use a ${totalButton} scale`}>
        {yScaleButtonLabel[totalButton]}
      </button>
      <div class="flex row center">
        <div class="canvas-box">
          <canvas bind:this={totalCallsCanvas} />
        </div>
      </div>
    </div>
  </div>
</div>

<script>
  import { RTTChart, StatusCountsChart } from "./charts.ts";
  import { onMount } from "svelte";
  
  let rttCanvas, totalCallsCanvas;

  export let tags, dataPoints;
  let rttChart, totalChart, totalResults, logarithmicXScale;

  let rttButton;
  let totalButton = "logarithmic";

  const opposite = {
    logarithmic: "linear",
    linear: "logarithmic"
  };

  const yScaleButtonLabel = {
    logarithmic: "log(n)",
    linear: "n"
  };
  
  $: initializeData(dataPoints);
  
  let mounted = false;
  onMount(() => {
    mounted = true;
    rttChart = new RTTChart(rttCanvas, dataPoints, logarithmicXScale);
    rttButton = opposite[rttChart.getYAxisType()];
    totalChart = new StatusCountsChart(totalCallsCanvas, dataPoints);
  });

  function toggleChart(chart) {
    // This is so the button to toggle the type will display the type switching to
    if (chart == rttChart) {
      chart.setYAxisType(rttButton);
      rttButton = opposite[rttButton];
    } else {
      chart.setYAxisType(totalButton);
      totalButton = opposite[totalButton];  
    }
  }

  function initializeData (dataPoints) {
    let stats, otherErrors, statusCounts;
    if (dataPoints.length > 0) {
      const first = dataPoints[0];
      const totalRTT = first.rttHistogram.clone();
      totalRTT.autoResize = true;
      let statusCounts2 = Object.assign({}, first.statusCounts);
      let otherErrors2 = Object.assign({}, first.testErrors);
      let responseTimeouts = first.responseTimeouts;
      for (let i = 1; i < dataPoints.length; i++) {
        const dp = dataPoints[i];
        totalRTT.add(dp.rttHistogram);
        for (const [status, count] of Object.entries(dp.statusCounts)) {
          statusCounts2[status] = count + (statusCounts2[status] || 0);
        }
        for (const [msg, count] of Object.entries(dp.testErrors)) {
          otherErrors2[msg] = count + (otherErrors2[msg] || 0);
        }
        responseTimeouts += dp.responseTimeouts;
      }
      statusCounts = Object.entries(statusCounts2).sort(([a], [b]) => a - b);
      statusCounts.forEach((stat) => stat.push(stat[1] / Number(totalRTT.getTotalCount())));
      statusCounts.push(["Sum", Number(totalRTT.getTotalCount()), 1]);
      otherErrors = Object.entries(otherErrors2);
      if (responseTimeouts > 0) {
        otherErrors.push(["Timeout", responseTimeouts]);
      }
      const MICROS_TO_MS = 1000;
      stats = [
        ["Avg", Math.round(totalRTT.getMean()) / MICROS_TO_MS],
        [
          "Min",
          Math.min(
            Number(totalRTT.getMaxValue()) / MICROS_TO_MS,
            Number(totalRTT.getMinNonZeroValue()) / MICROS_TO_MS
          )
        ],
        ["Max", Number(totalRTT.getMaxValue()) / MICROS_TO_MS],
        ["Std Dev", totalRTT.getStdDeviation() / MICROS_TO_MS],
        ["90th PCTL", Number(totalRTT.getValueAtPercentile(90)) / MICROS_TO_MS],
        ["95th PCTL", Number(totalRTT.getValueAtPercentile(95)) / MICROS_TO_MS],
        ["99th PCTL", Number(totalRTT.getValueAtPercentile(99)) / MICROS_TO_MS]
      ];
      logarithmicXScale = totalRTT.getTotalCount()
        && Number(totalRTT.getMaxValue()) > (totalRTT.getMean() + (5 * totalRTT.getStdDeviation()));
      totalRTT.free();
    } else {
      stats = [];
      otherErrors = [];
      statusCounts = [];
    }
    totalResults = {
      otherErrors,
      stats,
      statusCounts
    };
    if (mounted) {
      rttChart.updateDataSet(dataPoints, logarithmicXScale);
      rttButton = opposite[rttChart.getYAxisType()];
      totalChart.updateDataSet(dataPoints);
    }
  };
</script>

<style>
  button {
    background: var(--accent);
    color: var(--text);
  }
  .endpoint:not(:last-child) {
    margin-bottom: 5em;
  }
  .rtt {
    margin-bottom: 2em;
  }
  table {
    border-spacing: 0;
  }
  .overview td {
    max-width: 150px;
  }
  .overview td:last-child {
    text-align: right;
  }
  .overview td:not(:first-child) {
    padding-left: 2em;
  }
  td {
    max-width: 900px;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow: hidden;
    padding: 5px;
  }
  /* :hover pseudo class there twice to increase specificity */
  tr:hover:hover {
    background: var(--accent2);
  }
  tr:nth-child(even) {
    background: var(--accent);
  }
  .flex {
    display: flex;
    flex-wrap: wrap;
  }
  .flex.center {
    align-items: center;
  }
  .flex > .align-self-start {
    align-self: start;
  }
  .flex.row {
    flex-direction: row;
  }
  .flex.column {
    flex-direction: column;
  }
  .flex.margin-right {
    margin-right: 15px;
  }
  .y-scale {
    position: absolute;
    transform: translateY(50px);
  }
  @media (min-width: 1100px) {
    .canvas-box {
      width: calc(50vw - 50px);
    }
  }
  @media not (min-width: 1100px) {
    .canvas-box {
      width: calc(100vw - 100px);
    }
  }
</style>