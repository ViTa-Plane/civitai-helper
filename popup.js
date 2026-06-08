// --- HELPER TO RUN CODE ON THE ACTIVE WEBPAGE ---
async function runOnActiveTab(func) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  return chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: func
  });
}

// --- NEW: Helper to extract image details from the active tab ---
async function getPageData() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return { src: null, id: null };

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const img = document.querySelector('div.relative.flex.size-full.items-center.justify-center img[src*="civitai.com"]');
      const id = window.location.pathname.split('/').pop();
      return { src: img ? img.src : null, id: id };
    }
  });
  return results[0].result;
}



// --- BUTTON 1: DOWNLOAD METADATA (SCRAPE) ---
async function scrapeData() {
  await runOnActiveTab(() => {
    const imageId = window.location.pathname.split('/').pop();
    const trpcUrl = `${window.location.origin}/api/trpc/image.getGenerationData?input=${encodeURIComponent(JSON.stringify({json:{id: parseInt(imageId)}}))}`;

    fetch(trpcUrl)
      .then(response => response.json())
      .then(data => {
        chrome.runtime.sendMessage({
          type: "SAVE_WORKFLOW",
          imageId: imageId,
          rawResult: data.result.data.json,
          url: window.location.href
        });
      })
      .catch(err => console.error("Scraping failed:", err));
  });
}

// --- UPDATED BUTTON 2: DOWNLOAD IMAGE + THUMBNAIL ---
async function downloadCivitaiImage() {
  await runOnActiveTab(() => {
    const selector = 'div.relative.flex.size-full.items-center.justify-center img[src*="civitai.com"]';
    const img = document.querySelector(selector);

    if (!img) {
      console.error("Image not found in the expected container.");
      return;
    }

    const urlMatch = window.location.href.match(/images\/(\d+)/);
    const imageId = urlMatch ? urlMatch[1] : "downloaded_image";

    // Clean URL for highest resolution
    let highResUrl = img.src.split('/width=')[0].split('/quality=')[0];
    highResUrl = highResUrl.includes('?') ? `${highResUrl}&original=true` : `${highResUrl}?original=true`;

    const extMatch = highResUrl.match(/\.([a-z0-9]+)(\?|$)/i);
    const ext = (extMatch && extMatch[1] !== 'webp') ? extMatch[1] : 'jpg';

    chrome.runtime.sendMessage({
      action: "DOWNLOAD_IMAGE",
      url: highResUrl,
      filename: imageId,              // Include the directory
      extension: ext                  // Pass extension separately
    });

    // 2. Thumbnail Logic (Fixing the "download.jpg" issue)
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');
    const tempImg = new Image();
    tempImg.crossOrigin = "anonymous";
    tempImg.src = img.src;

    tempImg.onload = () => {
      const sourceSize = Math.min(tempImg.naturalWidth, tempImg.naturalHeight);
      const offsetX = (tempImg.naturalWidth - sourceSize) / 2;
      ctx.drawImage(tempImg, offsetX, 0, sourceSize, sourceSize, 0, 0, 200, 200);

        chrome.runtime.sendMessage({
          action: "DOWNLOAD_THUMBNAIL",
          url: canvas.toDataURL('image/jpeg', 0.9),
          filename: "thumbnails/tn_" + imageId, // Include directory
          extension: "jpg"
        });
    };
  });
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
  const themeToggle = document.getElementById('theme-toggle');
  const body = document.body;
  const scrapeBtn = document.getElementById('myButton');
  const downloadBtn = document.getElementById('myButton2');

  // 1. Theme Logic
  if (themeToggle) {
    const data = await chrome.storage.local.get('theme');
    if (data.theme === 'dark') {
      body.classList.add('dark-mode');
      themeToggle.checked = true;
    }
    themeToggle.addEventListener('change', () => {
      const isDark = themeToggle.checked;
      body.classList.toggle('dark-mode', isDark);
      chrome.storage.local.set({ theme: isDark ? 'dark' : 'light' });
    });
  }

  // 2. Load Thumbnail and ID
  const data = await getPageData();
  const thumb = document.getElementById('image-thumbnail');
  const idDisplay = document.getElementById('image-id-display');

  if (data && data.src) {
    thumb.src = data.src;
    thumb.style.display = 'block';
    idDisplay.innerText = `ID: ${data.id}`;
  }

  // 3. Button Listeners
  if (scrapeBtn) scrapeBtn.addEventListener('click', scrapeData);
  if (downloadBtn) downloadBtn.addEventListener('click', downloadCivitaiImage);
});
