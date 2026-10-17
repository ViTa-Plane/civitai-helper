const isCivitai = (url) => url && (url.includes("civitai.com/images/") || url.includes("civitai.red/images/"));

let activeState = { imageId: null, url: null, thumbnailUrl: null };

chrome.tabs.onUpdated.addListener((id, info, tab) => {
  if (tab.url) {
    chrome.action[isCivitai(tab.url) ? 'enable' : 'disable'](id);
  }
});

chrome.tabs.onActivated.addListener(async (info) => {
  const tab = await chrome.tabs.get(info.tabId);
  if (tab && tab.url) {
    chrome.action[isCivitai(tab.url) ? 'enable' : 'disable'](tab.id);
  }
});

chrome.action.disable();

const downloadQueue = new Map();

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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "CIVITAI_STATE_UPDATED") {
    activeState = {
      imageId: request.imageId,
      url: request.url,
      thumbnailUrl: request.thumbnailUrl
    };
    // Broadcast live to open popup views
    chrome.runtime.sendMessage(request).catch(() => {});
    sendResponse({ status: "ok" });
    return true;
  }

  if (request.action === "GET_ACTIVE_STATE") {
    sendResponse({ activeState });
    return true;
  }

  if (request.action === "DOWNLOAD_IMAGE" || request.action === "DOWNLOAD_THUMBNAIL") {
    downloadQueue.set(request.url, { name: request.filename, ext: request.extension });
    chrome.downloads.download({ url: request.url, filename: `${request.filename}.${request.extension}`, saveAs: false });
  }

  if (request.type === "SAVE_WORKFLOW") {
    (async () => {
      try {
        const raw = request.rawResult || {};
        const meta = raw.meta || {};
        const resources = raw.resources || meta.resources || [];
        const cleanText = (text) => text ? text.replace(/\n/g, " ").replace(/\s+/g, " ").trim() : "";

        async function getFilename(modelVersionId) {
          try {
            const res = await fetch(`https://civitai.com/api/v1/model-versions/${modelVersionId}`);
            const data = await res.json();
            return data.files.find(f => f.name.endsWith('.safetensors'))?.name || "unknown.safetensors";
          } catch (e) {
            return "unknown.safetensors";
          }
        }

        const processedResources = await Promise.all(resources.map(async (r) => ({
          ...r,
          filename: await getFilename(r.modelVersionId)
        })));

        const loraEntries = processedResources.filter(r => r.modelType === 'LORA');
        const originalPrompt = cleanText(meta.prompt || "");
        const loraPromptFormat = loraEntries
          .filter(r => !originalPrompt.includes(r.filename.replace('.safetensors', '')))
          .map(r => `<lora:${r.filename.replace('.safetensors', '')}:${r.strength || 1}>`)
          .join(" ");

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
          thumbnail: `civitai/tn_${request.imageId}.jpg`,
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
        const dataUrl = "data:application/json;base64," + btoa(String.fromCharCode(...new TextEncoder().encode(jsonString)));
        downloadQueue.set(dataUrl, { name: `${request.imageId}`, ext: "json" });
        chrome.downloads.download({ url: dataUrl });
      } catch (err) {
        console.error("Workflow save error:", err);
      }
    })();
    return true;
  }
});