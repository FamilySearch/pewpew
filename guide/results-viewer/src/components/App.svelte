<div>
  {#if buckets.length > 0}
    <div>
      <h1>Time Taken</h1>
      <p>{startTime} to {endTime}</p>
      <p>Total time: {deltaTime}</p>
      <h1>Results</h1>
      {#each buckets as [bucketId, dataPoints]}
	      <Endpoint {bucketId} {dataPoints} />
      {/each}
    </div>
  {:else}
    <DropZone on:fileDataParsed={bucketReceive}/>
  {/if}
</div>

<script>
  import DropZone from "./DropZone.svelte";
  import Endpoint from "./Endpoint/Endpoint.svelte";
  let buckets = [];

  let startTime, endTime, deltaTime;

  function bucketReceive(event) {
    buckets = event.detail.buckets;
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