let originalStyles = [];
let overlay = null;

// Expose globally for background script (context menu)
window.runDownloader = runDownloader;

// Keyboard Shortcut: Cmd/Ctrl + Shift + S
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    const btn = document.getElementById('injected-scribd-downloader-btn');
    if (btn && !btn.disabled) {
      runDownloader(150);
    }
  }
});





async function runDownloader(scrollDelayMs) {
  try {
    // Show visual status overlay in the page
    updateOverlay("Initializing...", "Starting connection to document layout engine...", 0, 100, false);

    // 1. Detect the page size before applying layout fixes
    const paperSize = detectDocumentPaperSize();
    
    // 2. Start scrolling through pages to trigger lazy loading
    const totalPages = await scrollThroughPages(scrollDelayMs);
    
    if (totalPages === 0) {
      removeOverlay();
      return;
    }

    // 3. Prepare the document layout for printing (Inject dynamic CSS using measured size)
    updateOverlay("Formatting page...", "Removing navigation panels and scaling content to fit.", 100, 100, false);
    prepareForPrint(paperSize);

    // 4. Wait for render stability
    updateOverlay("Rendering pages...", "Waiting for high-resolution graphics and custom fonts to settle.", 100, 100, false);
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Scroll back to the top so print captures starting from page 1
    window.scrollTo(0, 0);

    // 5. Trigger print dialog
    updateOverlay("Opening print dialog...", "Please select 'Save as PDF' as the Destination in the next step.", 100, 100, false);

    setTimeout(() => {
      const originalTitle = document.title;
      document.title = getDocumentTitle(); // Better File Naming: use exact title
      window.print();
      
      document.title = originalTitle; // Restore original title
      // 6. Restore page layout
      restorePage();

      // 7. Redirect or show completed state
      const urlParams = new URLSearchParams(window.location.search);
      const originalUrl = urlParams.get('original_url');
      if (originalUrl) {
        updateOverlay("Completed!");
        window.location.href = decodeURIComponent(originalUrl);
      } else {
        updateOverlay("Completed!");
        setTimeout(() => {
          removeOverlay();
        }, 3000);
      }
    }, 500);

  } catch (error) {
    showOverlayError(error.message);
  }
}

function getPageSelector() {
  if (document.querySelector('.outer_page')) return '.outer_page';
  if (document.querySelector('.newpage')) return '.newpage';
  if (document.querySelector('.outer_page_container')) return '.outer_page_container';
  if (document.querySelector('.reader_page')) return '.reader_page'; // Support for premium books
  if (document.querySelector('.page_content')) return '.page_content'; // Support for premium books
  return "[class*='page']";
}

async function scrollThroughPages(scrollDelayMs) {
  let scrolledCount = 0;
  let stableRounds = 0;
  let lastTotalPages = -1;
  const pageSelector = getPageSelector();

  while (stableRounds < 2) {
    const pageElements = document.querySelectorAll(pageSelector);
    const totalPages = pageElements.length;

    if (totalPages === 0) {
      throw new Error("No page elements detected. Are you on a Scribd document page?");
    }

    if (totalPages === lastTotalPages) {
      stableRounds++;
    } else {
      stableRounds = 0;
      lastTotalPages = totalPages;
    }

    updateOverlay(
      "Loading pages...",
      `Scrolling to load images and text assets. (Lazy loading)`,
      scrolledCount,
      totalPages
    );

    for (let i = scrolledCount; i < totalPages; i++) {
      pageElements[i].scrollIntoView({ behavior: 'instant', block: 'center' });
      await new Promise(resolve => setTimeout(resolve, scrollDelayMs));
      
      if ((i + 1) % 5 === 0 || i === totalPages - 1) {
        updateOverlay(
          "Loading pages...",
          `Scrolling to load images and text assets.`,
          i + 1,
          totalPages
        );
      }
    }

    scrolledCount = totalPages;
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return scrolledCount;
}

function detectDocumentPaperSize() {
  const candidates = [
    '.outer_page',
    '.newpage',
    '.outer_page_container',
    '.reader_page',
    '.page_content',
    "[class*='page']"
  ];

  for (const selector of candidates) {
    const element = document.querySelector(selector);
    if (!element) continue;

    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return {
        widthInches: rect.width / 96,
        heightInches: (rect.height / 96) + 0.04,
        selector
      };
    }
  }
  return null;
}

function prepareForPrint(paperSize) {
  originalStyles = [];

  // Hide toolbars
  const toolbars = document.querySelectorAll('.toolbar_top, .toolbar_bottom');
  toolbars.forEach(el => {
    originalStyles.push({ element: el, display: el.style.display });
    el.style.display = 'none';
  });

  // Clean container layouts
  const scrollers = document.querySelectorAll('.document_scroller');
  scrollers.forEach(element => {
    originalStyles.push({
      element,
      position: element.style.position,
      top: element.style.top,
      bottom: element.style.bottom,
      left: element.style.left,
      right: element.style.right,
      overflow: element.style.overflow,
      maxHeight: element.style.maxHeight,
      height: element.style.height,
      margin: element.style.margin,
      padding: element.style.padding
    });

    element.setAttribute('data-scribd-print-root', 'true');
    element.style.position = 'static';
    element.style.top = 'auto';
    element.style.bottom = 'auto';
    element.style.left = 'auto';
    element.style.right = 'auto';
    element.style.overflow = 'visible';
    element.style.maxHeight = 'none';
    element.style.height = 'auto';
    element.style.margin = '0';
    element.style.padding = '0';
  });

  // Inject print CSS with dynamically measured paper dimensions
  const existing = document.getElementById('scribd-print-styles');
  if (existing) existing.remove();

  const widthVal = paperSize ? `${paperSize.widthInches.toFixed(3)}in` : 'auto';
  const heightVal = paperSize ? `${paperSize.heightInches.toFixed(3)}in` : 'auto';

  const style = document.createElement('style');
  style.id = 'scribd-print-styles';
  style.textContent = `
    [class*="cookie"], [class*="Cookie"], [class*="consent"],
    [class*="Consent"], [class*="gdpr"], [class*="privacy-notice"],
    [class*="notice-banner"], [id*="cookie"], [id*="consent"],
    [class*="osano-cm"], [id*="osano"] {
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
      height: 0 !important;
      overflow: hidden !important;
    }

    [data-scribd-print-root="true"],
    .document_scroller {
      position: static !important;
      top: auto !important;
      right: auto !important;
      bottom: auto !important;
      left: auto !important;
      overflow: visible !important;
      height: auto !important;
      max-height: none !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    @media print {
      #scribd-downloader-overlay {
        display: none !important;
      }

      @page {
        size: ${widthVal} ${heightVal};
        margin: 0;
      }

      html,
      body {
        margin: 0 !important;
        padding: 0 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }

      .toolbar_top,
      .toolbar_bottom {
        display: none !important;
      }

      [data-scribd-print-root="true"],
      .document_scroller {
        position: static !important;
        top: auto !important;
        right: auto !important;
        bottom: auto !important;
        left: auto !important;
        overflow: visible !important;
        height: auto !important;
        max-height: none !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      .outer_page_container,
      .newpage_container {
        margin: 0 !important;
        padding: 0 !important;
        height: auto !important;
        min-height: 0 !important;
      }

      .outer_page_container > *:not(.outer_page),
      .newpage_container > *:not(.newpage) {
        display: none !important;
      }

      .outer_page {
        margin: 0 !important;
        break-inside: avoid !important;
        page-break-inside: avoid !important;
        break-after: page !important;
        page-break-after: always !important;
      }

      .outer_page:last-of-type,
      .outer_page:last-child,
      .newpage:last-of-type,
      .newpage:last-child {
        break-after: avoid !important;
        page-break-after: avoid !important;
      }

      mjx-container,
      .MathJax,
      .katex,
      math,
      svg {
        visibility: visible !important;
        overflow: visible !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function restorePage() {
  const existing = document.getElementById('scribd-print-styles');
  if (existing) existing.remove();

  originalStyles.forEach(item => {
    const el = item.element;
    if (!el) return;

    if (item.display !== undefined) {
      el.style.display = item.display;
    } else {
      el.removeAttribute('data-scribd-print-root');
      el.style.position = item.position;
      el.style.top = item.top;
      el.style.bottom = item.bottom;
      el.style.left = item.left;
      el.style.right = item.right;
      el.style.overflow = item.overflow;
      el.style.maxHeight = item.maxHeight;
      el.style.height = item.height;
      el.style.margin = item.margin;
      el.style.padding = item.padding;
    }
  });
  originalStyles = [];
}

/* UI Overlay Functions (now routed to button) */
function updateOverlay(status, detail, current, total, showPageCount = true) {
  const btn = document.getElementById('injected-scribd-downloader-btn');
  if (!btn) return;

  btn.disabled = true;
  btn.style.cursor = 'wait';
  btn.style.transform = 'scale(1)';

  if (current !== undefined && total !== undefined && total > 0) {
    const percent = Math.round((current / total) * 100) || 0;
    if (status === "Loading pages...") {
      btn.innerText = `⏳ Loading: ${percent}% (${current}/${total})`;
    } else {
      btn.innerText = `⏳ ${status} (${percent}%)`;
    }
    btn.style.background = `linear-gradient(90deg, #0d6e3e ${percent}%, #10864c ${percent}%)`;
  } else {
    btn.innerText = `⏳ ${status}`;
    btn.style.background = 'linear-gradient(135deg, #10864c, #22c55e)';
  }
}

function showOverlayError(errMessage) {
  const btn = document.getElementById('injected-scribd-downloader-btn');
  if (!btn) return;

  btn.innerText = '❌ Error (Click to retry)';
  btn.style.background = '#ef4444';
  btn.disabled = false;
  btn.style.cursor = 'pointer';
}

function removeOverlay() {
  const btn = document.getElementById('injected-scribd-downloader-btn');
  if (!btn) return;

  btn.innerText = '📥 Get Document';
  btn.style.background = 'linear-gradient(135deg, #10864c, #22c55e)';
  btn.disabled = false;
  btn.style.cursor = 'pointer';
}

// Initialization
(() => {
  // 1. Inject UI Button on page
  injectDownloadButton();

  // 2. Auto-start check when script loads in embed context
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('start_download') === 'true') {
    const scrollDelay = parseInt(urlParams.get('scroll_delay'), 10) || 150;
    
    // Wait a moment for page to initialize before starting
    setTimeout(() => {
      runDownloader(scrollDelay);
    }, 1000);
  }
})();

function injectDownloadButton() {
  if (document.getElementById('injected-scribd-downloader-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'injected-scribd-downloader-btn';
  btn.innerText = '📥 Get Document';
  btn.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 9999999;
    background: linear-gradient(135deg, #10864c, #22c55e);
    color: white;
    border: none;
    border-radius: 50px;
    padding: 12px 24px;
    font-size: 16px;
    font-weight: 600;
    box-shadow: 0 4px 15px rgba(16, 134, 76, 0.4);
    cursor: pointer;
    font-family: 'Inter', -apple-system, sans-serif;
    transition: transform 0.2s;
  `;
  btn.onmouseover = () => btn.style.transform = 'scale(1.05)';
  btn.onmouseout = () => btn.style.transform = 'scale(1)';
  btn.onclick = () => runDownloader(150);

  document.body.appendChild(btn);
}

function getDocumentTitle() {
  const h1 = document.querySelector('h1');
  if (h1 && h1.innerText) return h1.innerText.trim();
  
  const title = document.querySelector('title');
  if (title && title.innerText) {
    let rawTitle = title.innerText;
    // Strip common Scribd suffixes
    rawTitle = rawTitle.replace(/ - Scribd/gi, '');
    rawTitle = rawTitle.replace(/\| Scribd/gi, '');
    rawTitle = rawTitle.replace(/Read .*? Online/gi, '');
    return rawTitle.trim();
  }
  return 'Scribd_Document';
}
