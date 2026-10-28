// --- HELPER TO RUN CODE ON THE ACTIVE WEBPAGE ---
async function runOnActiveTab(func, args = []) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  return chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: func,
    args: args
  });
}

// --- DYNAMICALLY RESOLVE ACTIVE IMAGE USING EXACT CAROUSEL MAPPING ---
async function getPageData() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return { src: null, id: null, debugIndex: "1" };

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const modal = document.querySelector('div[role="dialog"], [class*="Modal"], [class*="Lightbox"]');
      const searchRoot = modal || document;

      // Enumerate image elements inside target container blocks, carousel transform slides, and general gallery images
      const transformSlideImgs = Array.from(searchRoot.querySelectorAll('[class*="transform-3d flex-[0_0_100%]"] img'));
      const containerImgs = Array.from(searchRoot.querySelectorAll('div.relative.flex.size-full.items-center.justify-center img'));
      const generalImgs = Array.from(searchRoot.querySelectorAll('img[src*="civitai"], img[src*="blobs"]'));

      const allImgs = [...transformSlideImgs, ...containerImgs, ...generalImgs];
      const validImages = [];
      const seenUrls = new Set();

      allImgs.forEach(img => {
        const src = img.src || '';
        const lowerSrc = src.toLowerCase();
        const altText = (img.alt || '').toLowerCase();

        const parentAnchor = img.closest('a');
        const anchorHref = parentAnchor ? parentAnchor.href.toLowerCase() : '';
        const isAdLink = anchorHref.includes('advertising.civitai.com');

        const isBadAsset =
          isAdLink ||
          altText.includes('advertisement') ||
          lowerSrc.includes('advertising.civitai.com') ||
          lowerSrc.includes('avatar') ||
          lowerSrc.includes('/users/') ||
          lowerSrc.includes('profile') ||
          lowerSrc.includes('bg') ||
          lowerSrc.includes('background') ||
          lowerSrc.includes('banner') ||
          lowerSrc.includes('default') ||
          img.classList.contains('mantine-Avatar-image') ||
          img.closest('[class*="Avatar"]') !== null ||
          img.closest('header') !== null;

        const rect = img.getBoundingClientRect();
        const isSmall = (rect.width > 0 && rect.width < 100) || (rect.height > 0 && rect.height < 100);

        if (!isBadAsset && !isSmall && !seenUrls.has(src)) {
          seenUrls.add(src);
          const hashMatch = src.match(/\/([a-zA-Z0-9-]{36})\//) || src.match(/\/xG1nkqKTMzGDvpLrqFT7WA\/([a-zA-Z0-9-_]+)\//);
          const imgId = hashMatch ? hashMatch[1] : "image";
          validImages.push({ src: src, id: imgId });
        }
      });

      // Locate pagination buttons to find raw 0-based active index and total buttons n
      const indicatorBar = searchRoot.querySelector('div.flex.justify-center.gap-1') ||
                           document.querySelector('div.flex.justify-center.gap-1');

      let rawActiveIndex = -1;
      let totalButtonsCount = 0;

      if (indicatorBar) {
        const indicatorButtons = Array.from(indicatorBar.querySelectorAll('button'));
        totalButtonsCount = indicatorButtons.length;
        indicatorButtons.forEach((btn, idx) => {
          if (btn.getAttribute('data-active') === 'true' || btn.classList.contains('bg-blue-6')) {
            rawActiveIndex = idx;
          }
        });
      }

      if (rawActiveIndex === -1) {
        const activeBtn = searchRoot.querySelector('button[data-active="true"]');
        if (activeBtn && activeBtn.parentElement) {
          const siblings = Array.from(activeBtn.parentElement.children);
          totalButtonsCount = siblings.length;
          rawActiveIndex = siblings.indexOf(activeBtn);
        }
      }

      let userIndex = 1;
      let mappedArrayIndex = 0;
      const m = validImages.length;

      // If buttons are found, use carousel mapping rules
      if (rawActiveIndex !== -1 && totalButtonsCount > 0) {
        userIndex = rawActiveIndex + 1;
        const n = totalButtonsCount;

        if (m > 0) {
          if (userIndex === 1) {
            mappedArrayIndex = 0;
          } else if (userIndex >= 2 && userIndex < n && m >= 2) {
            mappedArrayIndex = m - 2;
          } else if (userIndex === n && m >= 1) {
            mappedArrayIndex = m - 1;
          } else {
            mappedArrayIndex = Math.min(rawActiveIndex, m - 1);
          }
        }
      } else {
        // Fallback when buttons are NOT found
        if (m === 3) {
          userIndex = 2;
          mappedArrayIndex = 1; // Select index 2
        } else {
          userIndex = 1;
          mappedArrayIndex = 0; // Default to index 1
        }
      }

      const detectedIndex = `${userIndex}`;
      let targetImgObj = validImages[mappedArrayIndex] || validImages[rawActiveIndex] || validImages[0] || null;

      let src = targetImgObj ? targetImgObj.src : null;

      const urlMatch = window.location.pathname.match(/\/images\/(\d+)/);
      let id = urlMatch ? urlMatch[1] : null;

      if (!id && targetImgObj && targetImgObj.id !== "image") {
        id = targetImgObj.id;
      }

      if (!id) {
        id = window.location.pathname.split('/').filter(Boolean).pop() || "image";
      }

      return { src: src, id: id, debugIndex: detectedIndex };
    }
  });

  return results && results[0] ? results[0].result : { src: null, id: null, debugIndex: "1" };
}

// --- UI UPDATER WITH DEBOUNCE BUFFER ---
let lastProcessedId = null;
let pendingUpdateTimer = null;

function updatePopupUI(data) {
  if (!data) return;

  const thumb = document.getElementById('image-thumbnail');
  const idDisplay = document.getElementById('image-id-display');
  const debugDisplay = document.getElementById('debug-index');

  if (debugDisplay) {
    debugDisplay.innerText = `Index: ${data.debugIndex}`;
  }

  if (idDisplay && data.id) {
    idDisplay.innerText = `ID: ${data.id}`;
  }

  if (thumb && data.src) {
    thumb.src = data.src;
    thumb.style.display = 'block';
  }

  if (!data.id) return;

  if (lastProcessedId !== data.id) {
    lastProcessedId = data.id;

    if (pendingUpdateTimer) clearTimeout(pendingUpdateTimer);

    pendingUpdateTimer = setTimeout(async () => {
      const freshData = await getPageData();
      if (thumb && freshData && freshData.src) {
        thumb.src = freshData.src;
        thumb.style.display = 'block';
      }
      if (debugDisplay && freshData) {
        debugDisplay.innerText = `Index: ${freshData.debugIndex}`;
      }
      if (idDisplay && freshData) {
        idDisplay.innerText = `ID: ${freshData.id || "Unknown"}`;
      }
    }, 400);
  }
}

// --- BUTTON 1: DOWNLOAD METADATA (SCRAPE) ---
async function scrapeData() {
  await runOnActiveTab(() => {
    const match = window.location.pathname.match(/\/images\/(\d+)/);
    const imageId = match ? match[1] : window.location.pathname.split('/').pop();
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

// --- BUTTON 2: DOWNLOAD ACTIVE IMAGE + THUMBNAIL ---
async function downloadCivitaiImage() {
  // Reuse getPageData to guarantee 100% synchronization with the popup preview and mapping rules
  const pageData = await getPageData();
  if (!pageData || !pageData.src) return;

  const imageId = pageData.id || "downloaded_image";

  let highResUrl = pageData.src.split('/width=')[0].split('/quality=')[0];
  highResUrl = highResUrl.includes('?') ? `${highResUrl}&original=true` : `${highResUrl}?original=true`;

  const extMatch = highResUrl.match(/\.([a-z0-9]+)(\?|$)/i);
  const ext = (extMatch && extMatch[1] !== 'webp') ? extMatch[1] : 'jpg';

  // Route image download
  chrome.runtime.sendMessage({
    action: "DOWNLOAD_IMAGE",
    url: highResUrl,
    filename: imageId,
    extension: ext
  });

  // Generate canvas thumbnail from verified preview source
  await runOnActiveTab((imgSrc, imgId) => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');
    const tempImg = new Image();
    tempImg.crossOrigin = "anonymous";
    tempImg.src = imgSrc;

    tempImg.onload = () => {
      const sourceSize = Math.min(tempImg.naturalWidth, tempImg.naturalHeight);
      const offsetX = (tempImg.naturalWidth - sourceSize) / 2;
      ctx.drawImage(tempImg, offsetX, 0, sourceSize, sourceSize, 0, 0, 200, 200);

      chrome.runtime.sendMessage({
        action: "DOWNLOAD_THUMBNAIL",
        url: canvas.toDataURL('image/jpeg', 0.9),
        filename: "thumbnails/tn_" + imgId,
        extension: "jpg"
      });
    };
  }, [pageData.src, imageId]);
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
  const themeToggle = document.getElementById('theme-toggle');
  const body = document.body;
  const scrapeBtn = document.getElementById('myButton');
  const downloadBtn = document.getElementById('myButton2');

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

  // Initial load
  const initialData = await getPageData();
  updatePopupUI(initialData);

  // Poll active tab every 300ms to stay synchronized with gallery browsing
  const pollInterval = setInterval(async () => {
    try {
      const currentData = await getPageData();
      updatePopupUI(currentData);
    } catch (e) {
      clearInterval(pollInterval);
    }
  }, 300);

  window.addEventListener('unload', () => clearInterval(pollInterval));

  if (scrapeBtn) scrapeBtn.addEventListener('click', scrapeData);
  if (downloadBtn) downloadBtn.addEventListener('click', downloadCivitaiImage);
});