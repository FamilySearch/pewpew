<div class="endpoint">
  <h2>{bucketId.method} {bucketId.url}</h2>
  <ul>
    {#each Object.entries(bucketId) as [key, value]}
      {#if key != "method" && key != "url"}
        <li>{key} - {value}</li>
      {/if}
    {/each}
  </ul>
  <div class="flex column center">
    <h3>Endpoint Summary</h3>
    <div class="flex row">
      <div class="flex column center table-box margin-right">
        <h5>RTT Stats</h5>
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
      <div class="flex column center">
        <h5>HTTP Status Counts and Errors</h5>
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
        {#if totalResults.otherErrors.length > 0}
          <h5>Other Errors</h5>
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
        {/if}
      </div>
    </div>
  </div>
  <div class="rtt flex column center">
    <h3>RTT Stats</h3>
    <button on:click={() => toggleChart(rttChart)}>
      Switch to {rttButton}
    </button>
    <div class="flex row center">
      <div class="canvas-box">
        <canvas bind:this={rttCanvas} />
      </div>
    </div>
  </div>
  <div class="flex column center">
    <h3>HTTP Status Counts and Errors</h3>
    <button on:click={() => toggleChart(totalChart)}>
      Switch to {totalButton}
    </button>
    <div class="flex row center">
      <div class="canvas-box">
        <canvas bind:this={totalCallsCanvas} />
      </div>
    </div>
  </div>
</div>

<script>
  import { RTT, totalCalls } from "./charts.ts";
  import { onMount } from "svelte";
  
  let rttCanvas, totalCallsCanvas;

  export let bucketId, dataPoints;
  let rttChart, totalChart;

  let rttButton, totalButton;
  
  onMount(() => {
    rttChart = RTT(rttCanvas, dataPoints);
    rttButton = rttChart.config.options.scales.yAxes[0].type === "linear" ? "logarithmic" : "linear";
    totalChart = totalCalls(totalCallsCanvas, dataPoints);
    totalButton = "logarithmic";
  });

  function toggleChart(chart) {
    const chartConfig = chart.config.options.scales.yAxes[0];
    if (chartConfig.type === "linear") {
      chartConfig.type = "logarithmic";
    } else if (chartConfig.type === "logarithmic") {
      chartConfig.type = "linear";
    }

    // This is so the button to toggle the type will display the type switching to
    rttButton = rttChart ? (rttChart.config.options.scales.yAxes[0].type === "linear" ? "logarithmic" : "linear") : "";
    totalButton = totalChart ? (totalChart.config.options.scales.yAxes[0].type === "linear" ? "logarithmic" : "linear") : "";  
    chart.update();
  }

  function total (dataPoints) {
    const first = dataPoints[0];
    const totalRTT = first.rttHistogram.clone();
    totalRTT.autoResize = true;
    let statusCounts = Object.assign({}, first.statusCounts);
    let otherErrors = Object.assign({}, first.testErrors);
    let responseTimeouts = first.responseTimeouts;
    for (let i = 1; i < dataPoints.length; i++) {
      const dp = dataPoints[i];
      totalRTT.add(dp.rttHistogram);
      for (const [status, count] of Object.entries(dp.statusCounts)) {
        statusCounts[status] = count + (statusCounts[status] || 0);
      }
      for (const [msg, count] of Object.entries(dp.testErrors)) {
        otherErrors[msg] = count + (otherErrors[msg] || 0);
      }
      responseTimeouts += dp.responseTimeouts;
    }
    statusCounts = Object.entries(statusCounts).sort(([a], [b]) => a - b);
    statusCounts.forEach((stat) => stat.push(stat[1] / Number(totalRTT.getTotalCount())));
    statusCounts.push(["Sum", Number(totalRTT.getTotalCount()), 1]);
    otherErrors = Object.entries(otherErrors);
    if (responseTimeouts > 0) {
      otherErrors.push(["Timeout", responseTimeouts]);
    }
    const MICROS_TO_MS = 1000;
    return {
      otherErrors,
      stats: [
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
      ],
      statusCounts
    };
  };

  const totalResults = total(dataPoints);
</script>

<style>
  .endpoint:not(:last-child) {
    margin-bottom: 5em;
  }
  .rtt {
    margin-bottom: 2em;
  }
  ul {
    list-style: none;
  }
  .table-box {
    max-width: 400px;
  }
  table {
    border-spacing: 0;
  }
  td {
    max-width: 150px;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow: hidden;
  }
  tr:nth-child(even) {
    background: #efefef;
  }
  td:not(:first-child) {
    padding-left: 2em;
  }
  td {
    padding: 5px;
  }
  td:last-child {
    text-align: right;
  }
  .flex {
    display: flex;
  }
  .flex.center {
    align-items: center;
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
  .canvas-box {
    position: relative;
    width: calc(100vw - 100px);
  }
</style>