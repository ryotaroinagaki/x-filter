const DEFAULT_CONFIG = {
  maxScrolls: 8,
  scrollDelayMs: 1400,
  idleRoundsLimit: 2,
  thresholds: {
    likes: 100,
    reposts: 50,
    replies: 20
  }
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "START_COLLECTION") {
    return false;
  }

  handleStartCollection(message.config)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        status: "error",
        error: error instanceof Error ? error.message : "Unknown background error"
      });
    });

  return true;
});

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
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "COLLECT_POPULAR_LINK_POSTS",
      config
    });

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
