// Service worker: opens the side panel from the toolbar button. No alarms, no schedulers,
// no network calls. Everything else happens in the side panel and the content script.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error: unknown) => {
  console.error("Page Push could not set the side panel behaviour", error);
});
