// Content script for facebook.com: a thin bridge from chrome.runtime to the controller.
// It acts only when the side panel asks, and only on the plan it is holding.
import { createController } from "./controller.ts";
import { isPanelRequest, type ContentEvent, type ContentReply } from "./messages.ts";

const controller = createController({
  document,
  location,
  notify(event: ContentEvent) {
    // The side panel may be closed; nobody listening is fine.
    chrome.runtime.sendMessage(event).catch(() => undefined);
  },
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse: (reply: ContentReply) => void) => {
  if (!isPanelRequest(message)) return undefined;
  sendResponse(controller.handle(message));
  return undefined;
});
