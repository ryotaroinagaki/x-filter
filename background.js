const DEFAULT_CONFIG = {
  maxScrolls: 30,
  scrollDelayMs: 1400,
  fallbackLimit: 10,
  thresholds: {
    minScore: 30
  }
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "START_COLLECTION") {
    handleStartCollection(message.config)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          status: "error",
          error: error instanceof Error ? error.message : "Unknown background error"
        });
      });
    return true;
  }

  if (message?.type === "STOP_COLLECTION") {
    handleMonitoringMessage(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          status: "error",
          error: error instanceof Error ? error.message : "Unknown background error"
        });
      });
    return true;
  }

  if (message?.type === "START_MONITORING" || message?.type === "STOP_MONITORING") {
    handleMonitoringMessage(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          status: "error",
          error: error instanceof Error ? error.message : "Unknown background error"
        });
      });
    return true;
  }

  return false;
});

async function handleMonitoringMessage(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id || !tab.url) {
    return { status: "error", error: "Active tab was not found." };
  }

  const requiresPage = message.type !== "STOP_COLLECTION";
  if (requiresPage && !isSupportedUrl(tab.url)) {
    return { status: "error", error: "Open X home timeline before running the collector." };
  }

  const config = mergeConfig(DEFAULT_CONFIG, message.config ?? {});

  try {
    return await sendMonitoringMessage(tab.id, message.type, config);
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : "Unable to reach the content script on the active tab."
    };
  }
}

async function sendMonitoringMessage(tabId, type, config) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type, config });
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      throw error;
    }

    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return chrome.tabs.sendMessage(tabId, { type, config });
  }
}

async function handleStartCollection(partialConfig = {}) {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.id || !tab.url) {
    return {
      status: "error",
      error: "Active tab was not found."
    };
  }

  if (!isSupportedUrl(tab.url)) {
    return {
      status: "error",
      error: "Open X home timeline before running the collector."
    };
  }

  const config = mergeConfig(DEFAULT_CONFIG, partialConfig);

  try {
    const response = await sendCollectionMessage(tab.id, config);

    if (!response) {
      return {
        status: "error",
        error: "The content script did not return any data."
      };
    }

    return response;
  } catch (error) {
    return {
      status: "error",
      error:
        error instanceof Error
          ? error.message
          : "Unable to reach the content script on the active tab."
    };
  }
}

async function sendCollectionMessage(tabId, config) {
  try {
    return await chrome.tabs.sendMessage(tabId, {
      type: "COLLECT_POPULAR_LINK_POSTS",
      config
    });
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      throw error;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });

    return chrome.tabs.sendMessage(tabId, {
      type: "COLLECT_POPULAR_LINK_POSTS",
      config
    });
  }
}

function isSupportedUrl(urlString) {
  const url = new URL(urlString);
  const isX = url.hostname === "x.com" || url.hostname === "twitter.com";
  return isX && url.pathname === "/home";
}

function mergeConfig(baseConfig, partialConfig) {
  return {
    ...baseConfig,
    ...partialConfig,
    thresholds: {
      ...baseConfig.thresholds,
      ...(partialConfig?.thresholds ?? {})
    }
  };
}

function isMissingReceiverError(error) {
  return (
    error instanceof Error &&
    error.message.includes("Could not establish connection. Receiving end does not exist.")
  );
}
