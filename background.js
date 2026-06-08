// --- DYNAMIC ICON DISABLING ---
const isCivitai = (url) => url && (url.includes("civitai.com/images/") || url.includes("civitai.red/images/"));

const update = (tabId, url) => {
  chrome.action[isCivitai(url) ? 'enable' : 'disable'](tabId);
};

// Listeners
chrome.tabs.onUpdated.addListener((id, info, tab) => info.status === 'complete' && update(id, tab.url));
chrome.tabs.onActivated.addListener((info) => chrome.tabs.get(info.tabId, (t) => update(t.id, t.url)));

// Set default
chrome.action.disable();

// --- YOUR EXISTING CODE STARTS HERE ---
const downloadQueue = new Map();

// SINGLE LISTENER - Handles all naming
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (downloadQueue.has(item.url)) {
    const data = downloadQueue.get(item.url);
    suggest({
      filename: `Civitai/${data.name}.${data.ext}`,
      conflictAction: "uniquify"
    });
    downloadQueue.delete(item.url);
  } else {
    suggest();
  }
});

// Main Message Handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "DOWNLOAD_IMAGE" || request.action === "DOWNLOAD_THUMBNAIL") {
        // 1. Set the queue
        downloadQueue.set(request.url, {
          name: request.filename,
          ext: request.extension
        });

        // 2. Trigger download with the filename forced in the parameters
        // THIS is the key: forcing the filename here prevents the race condition
        chrome.downloads.download({
          url: request.url,
          filename: `${request.filename}.${request.extension}`,
          saveAs: false
        }, (downloadId) => {
            // Optional: clear queue if download initiation succeeds
            // downloadQueue.delete(request.url);
        });
  }

  // CASE 2: Metadata / Workflow Save
  if (request.type === "SAVE_WORKFLOW") {
    const raw = request.rawResult || {};
    const meta = raw.meta || {};
    const resources = raw.resources || meta.resources || [];

    const cleanText = (text) => text ? text.replace(/\n/g, " ").replace(/\s+/g, " ").trim() : "";

    // Helper to get filenames from Civitai API
    async function getFilename(modelVersionId) {
      try {
        const response = await fetch(`https://civitai.com/api/v1/model-versions/${modelVersionId}`);
        const data = await response.json();
        return data.files.find(f => f.name.endsWith('.safetensors'))?.name || "unknown.safetensors";
      } catch (e) {
        return "unknown.safetensors";
      }
    }

    // Process all resources asynchronously
    Promise.all(resources.map(async (r) => {
      const filename = await getFilename(r.modelVersionId);
      return { ...r, filename };
    })).then(processedResources => {

      const loraEntries = processedResources.filter(r => r.modelType === 'LORA');

      // 1. Get the original prompt text
      const originalPrompt = cleanText(meta.prompt || "");

      // 2. Filter LoRAs: only include if not already present in the prompt
      const loraPromptFormat = loraEntries
          .filter(r => {
            const loraName = r.filename.replace('.safetensors', '');
            // Check if the loraName already exists in the prompt text
            return !originalPrompt.includes(loraName);
          })
          .map(r => `<lora:${r.filename.replace('.safetensors', '')}:${r.strength || 1}>`)
          .join(" ");

      // 3. Construct the final prompt
      const finalPrompt = (originalPrompt + " " + loraPromptFormat).trim();



      const checkpoint = processedResources.find(r => r.modelType === 'Checkpoint');
      const modelName = checkpoint ? checkpoint.filename.replace('.safetensors', '') : (meta.Model || "Unknown");

      const workflowData = {
        name: `${request.imageId}`,
        url: request.url,
        category: "civitai workflows",
        comment: "",
        prompt: finalPrompt,
        negative_prompt: cleanText(meta.negativePrompt || ""),
        lora: loraEntries.map(r => r.modelName).join(", "),
        thumbnail:"civitai/tn_" + `${request.imageId}` + ".jpg",
        params: {
          model_name: modelName,
          seed: meta.seed || "N/A",
          steps: meta.steps || "N/A",
          cfg_scale: meta.cfgScale || meta.cfg || "N/A",
          sampler: meta.sampler || "N/A",
          size: `${meta.width || 0} x ${meta.height || 0}`,
          clip_skip: meta.clipSkip || meta.ClipSkip || "N/A"
        }
      };

      const jsonString = JSON.stringify(workflowData, null, 2);
      const dataUrl = "data:application/json;base64," + btoa(unescape(encodeURIComponent(jsonString)));
      const filename = `prompts_${request.imageId}`;

      // Add to queue and trigger
      downloadQueue.set(dataUrl, { name: filename, ext: "json" });
      chrome.downloads.download({ url: dataUrl });
    });

    return true; // CRITICAL: Tells Chrome to keep the message channel open for the async fetch!
  }
});
