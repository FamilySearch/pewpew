<div class="drop-zone" on:dragover={dragOverHandler} on:drop={dropHandler} >
  <div>Drag Results File(s) Here</div>
  <div>
      <input bind:this={inputFiles} type="file" multiple accept=".json" on:change={() => fileSelector(this.files)}/>
      <button on:click={() => inputFiles.click()}>Or choose some files(s)...</button>
  </div>
  <div bind:this={spinner} class="loader"></div>
  <div bind:this={errorMessage} class="fileParseError hide">{fileParseError}</div>
</div>

<script>
  import * as model from "../model.ts";
  import { createEventDispatcher } from "svelte";
  const wasmInit = import("hdr-histogram-wasm")
    .then((mod) => {
      return mod.default()
    });

  const dispatch = createEventDispatcher();

  let errorMessage, inputFiles, fileParseError, spinner;

  async function dropHandler(e) {
    e.preventDefault();
    document.body.classList.remove("dragOver");
    if (!e.dataTransfer) {
      return;
    }
    const promises = [];
    await fileSelector(e.dataTransfer.files);
  }

  function dragOverHandler(e) {
    e.preventDefault();
    document.body.classList.add("dragOver");
  }

  async function fileSelector(files) {
    spinner.classList.add("loading");
    try {
      const promises = [];
      for (const file of files) {
        promises.push(model.parseStatsFile(file));
      }
      const promise = await wasmInit;
      const buckets = (await Promise.all(promises)).reduce((a, b) => a.concat(b), []);
      setTimeout(() => {
        dispatch("fileDataParsed", { buckets });
      }, 15)
    } catch (e) {
      console.error(e);
      spinner.classList.remove("loading");
      fileParseError = e.message;
      errorMessage.classList.remove("hide");
      setTimeout(() => errorMessage.classList.add("hide"), 10000);
    }
  }
</script>

<style>
.drop-zone {
  display: none;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  position: fixed;
  padding: 1em;
  font-size: 5em;
  top: 1.5rem;
  left: 1.5rem;
  height: calc(100vh - 3rem);
  width: calc(100vw - 3rem);
  border: #777 dashed 4px;
}

.drop-zone:only-child {
  display: flex;
}

input {
  display: none
}

.fileParseError {
  display: flex;
  position: fixed;
  bottom: 0;
  background: #fff0f0;
  color: #ff9494;
  font-size: 1rem;
  justify-content: center;
  align-items: center;
  transition: transform 0.5s;
  padding: 0.5rem;
}

.fileParseError.hide {
  transform: translateY(100%);
}

.loader {
  opacity: 0;
  border: 16px solid #f3f3f3;
  border-radius: 50%;
  border-top: 16px solid #3498db;
  min-width: 120px;
  min-height: 120px;
  transition: opacity 0.5s ease-in;
}
:global(.loader.loading) {
  animation: spin 2s linear infinite;
  opacity: 1
}
@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
</style>