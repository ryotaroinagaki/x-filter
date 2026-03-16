const SUPPORTED_HOSTS = new Set(["x.com", "twitter.com"]);
const COLLECTION_LOCK = {
  inFlight: false
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "COLLECT_POPULAR_LINK_POSTS") {
    return false;
  }

  if (COLLECTION_LOCK.inFlight) {
    sendResponse({
      status: "error",
      error: "A collection is already running."
    });
    return false;
  }

  COLLECTION_LOCK.inFlight = true;

  collectPopularLinkPosts(message.config)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        status: "error",
        error: error instanceof Error ? error.message : "Unknown collection error"
      });
    })
    .finally(() => {
      COLLECTION_LOCK.inFlight = false;
    });

  return true;
});

async function collectPopularLinkPosts(config) {
  ensureSupportedPage();

  const postMap = new Map();
  collectVisiblePosts(postMap);

  for (let scrollIndex = 0; scrollIndex < config.maxScrolls; scrollIndex += 1) {
    window.scrollBy({
      top: Math.max(window.innerHeight * 0.9, 700),
      behavior: "smooth"
    });

    await wait(config.scrollDelayMs);
    collectVisiblePosts(postMap);
  }

  const candidatePosts = Array.from(postMap.values());
  const popularPosts = sortPostsByPopularity(
    candidatePosts.filter((post) => passesThreshold(post, config.thresholds))
  );
  const usedFallback = popularPosts.length === 0 && candidatePosts.length > 0;
  const displayedPosts = usedFallback
    ? buildFallbackPosts(candidatePosts, config.fallbackLimit)
    : popularPosts;

  return {
    status: "ok",
    scannedCount: candidatePosts.length,
    matchedCount: popularPosts.length,
    displayedCount: displayedPosts.length,
    usedFallback,
    items: displayedPosts,
    popularPosts: displayedPosts
  };
}

function ensureSupportedPage() {
  const url = new URL(window.location.href);
  if (!SUPPORTED_HOSTS.has(url.hostname) || url.pathname !== "/home") {
    throw new Error("Open the X home timeline and try again.");
  }

  if (!document.querySelector('article[data-testid="tweet"]')) {
    throw new Error("No tweet articles were found on the page.");
  }
}

function collectVisiblePosts(postMap) {
  const articles = document.querySelectorAll('article[data-testid="tweet"]');

  for (const article of articles) {
    const post = extractPostFromArticle(article);
    if (!post) {
      continue;
    }

    postMap.set(post.postId, post);
  }
}

function extractPostFromArticle(article) {
  const postAnchor = findPostAnchor(article);
  if (!postAnchor) {
    return null;
  }

  const postUrl = normalizeUrl(postAnchor.href);
  const postId = extractPostId(postUrl);
  if (!postId) {
    return null;
  }

  const externalUrl = extractExternalUrl(article);
  if (!externalUrl) {
    return null;
  }

  const metrics = extractMetrics(article);
  const authorHandle = extractHandleFromPostUrl(postUrl);
  const authorName = extractAuthorName(article, authorHandle);
  const text = extractText(article);
  const timeElement = article.querySelector("time");
  const createdAt = timeElement?.getAttribute("datetime") ?? null;

  return {
    postId,
    postUrl,
    authorName,
    authorHandle,
    text,
    externalUrl,
    likeCount: metrics.likes,
    repostCount: metrics.reposts,
    replyCount: metrics.replies,
    createdAt
  };
}

function findPostAnchor(article) {
  const anchors = article.querySelectorAll('a[href*="/status/"]');

  for (const anchor of anchors) {
    const href = anchor.getAttribute("href");
    if (!href) {
      continue;
    }

    if (/\/status\/\d+/.test(href)) {
      return anchor;
    }
  }

  return null;
}

function extractExternalUrl(article) {
  const anchors = article.querySelectorAll("a[href]");

  for (const anchor of anchors) {
    const href = anchor.href;
    if (!href) {
      continue;
    }

    const normalized = normalizeUrl(href);
    const url = new URL(normalized);
    const isXHost = SUPPORTED_HOSTS.has(url.hostname);
    const isStatusLink = /\/status\/\d+/.test(url.pathname);
    const isProfileLink = !isStatusLink && /^\/[^/]+$/.test(url.pathname);
    const isIntentLink = url.pathname.startsWith("/intent/");

    if (isXHost || isProfileLink || isIntentLink) {
      continue;
    }

    return extractReadableExternalUrl(anchor, normalized);
  }

  return null;
}

function extractReadableExternalUrl(anchor, fallbackUrl) {
  const title = anchor.getAttribute("title");
  if (looksLikeUrl(title)) {
    return normalizeExternalValue(title);
  }

  const text = anchor.textContent?.trim();
  if (looksLikeUrl(text)) {
    return normalizeExternalValue(text);
  }

  return fallbackUrl;
}

function extractMetrics(article) {
  const metrics = {
    replies: 0,
    reposts: 0,
    likes: 0
  };

  const metricMap = {
    reply: "replies",
    retweet: "reposts",
    like: "likes"
  };

  const buttons = article.querySelectorAll('[data-testid]');
  for (const button of buttons) {
    const testId = button.getAttribute("data-testid");
    const metricName = metricMap[testId];

    if (!metricName) {
      continue;
    }

    metrics[metricName] = extractMetricValue(button);
  }

  return metrics;
}

function extractMetricValue(node) {
  const ariaLabel = node.getAttribute("aria-label");
  if (ariaLabel) {
    const ariaValue = extractNumberFromString(ariaLabel);
    if (ariaValue !== null) {
      return ariaValue;
    }
  }

  const text = node.textContent?.trim() ?? "";
  const textValue = parseMetricNumber(text);
  return textValue ?? 0;
}

function extractText(article) {
  const textNode = article.querySelector('[data-testid="tweetText"]');
  return textNode?.innerText?.trim() ?? "";
}

function extractAuthorName(article, authorHandle) {
  const anchor = article.querySelector('a[role="link"][href^="/"]');
  const label = anchor?.getAttribute("aria-label") ?? "";
  if (label) {
    return label.split("@")[0].trim();
  }

  const spans = article.querySelectorAll("span");
  for (const span of spans) {
    const value = span.textContent?.trim();
    if (!value || value === authorHandle || value.startsWith("@")) {
      continue;
    }

    return value;
  }

  return authorHandle.replace(/^@/, "");
}

function extractHandleFromPostUrl(postUrl) {
  const url = new URL(postUrl);
  const [handle] = url.pathname.split("/").filter(Boolean);
  return handle ? `@${handle}` : "@unknown";
}

function extractPostId(postUrl) {
  const match = postUrl.match(/\/status\/(\d+)/);
  return match?.[1] ?? null;
}

function passesThreshold(post, thresholds) {
  return (
    post.likeCount >= thresholds.likes ||
    post.repostCount >= thresholds.reposts ||
    post.replyCount >= thresholds.replies
  );
}

function sortPostsByPopularity(posts) {
  return [...posts].sort((left, right) => {
    if (right.likeCount !== left.likeCount) {
      return right.likeCount - left.likeCount;
    }
    if (right.repostCount !== left.repostCount) {
      return right.repostCount - left.repostCount;
    }
    return right.replyCount - left.replyCount;
  });
}

function buildFallbackPosts(candidatePosts, fallbackLimit) {
  return sortPostsByPopularity(candidatePosts)
    .slice(0, fallbackLimit)
    .map((post) => ({
      ...post,
      isFallback: true
    }));
}

function normalizeUrl(input) {
  return new URL(input, window.location.origin).toString();
}

function normalizeExternalValue(value) {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function extractNumberFromString(value) {
  const match = value.match(/([\d.,]+[KMB]?)/i);
  if (!match) {
    return null;
  }

  return parseMetricNumber(match[1]);
}

function parseMetricNumber(value) {
  const normalized = value.replace(/,/g, "").trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  const suffix = normalized.slice(-1);
  const multipliers = {
    K: 1_000,
    M: 1_000_000,
    B: 1_000_000_000
  };

  if (suffix in multipliers) {
    const numeric = Number.parseFloat(normalized.slice(0, -1));
    return Number.isNaN(numeric) ? null : Math.round(numeric * multipliers[suffix]);
  }

  const numeric = Number.parseInt(normalized, 10);
  return Number.isNaN(numeric) ? null : numeric;
}

function looksLikeUrl(value) {
  return typeof value === "string" && /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}/i.test(value.trim());
}
