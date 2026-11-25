chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fillField') {
    const el = document.querySelector(request.selector);
    if (el) {
      el.focus();
      el.value = request.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      sendResponse({ status: 'success' });
    } else {
      sendResponse({ status: 'not_found' });
    }
  }
});
