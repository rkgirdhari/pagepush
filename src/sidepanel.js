document.getElementById('fill-bio').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { action: 'fillField', selector: 'input[name*="bio"], textarea[name*="bio"], [aria-label*="Bio"]', value: document.getElementById('bio-template').value });
});

document.getElementById('fill-post').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { action: 'fillField', selector: 'textarea[name*="description"], [aria-label*="Create Post"], [aria-label*="Write something"]', value: document.getElementById('post-template').value });
});
