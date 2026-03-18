const SUPPORTED_HOSTS = new Set(["x.com", "twitter.com"]);
const COLLECTION_LOCK = {
  inFlight: false,
  stopRequested: false
};
const MONITOR_STATE = { observer: null, postMap: new Map() };

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "COLLECT_POPULAR_LINK_POSTS") {
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
  }

  if (message?.type === "START_MONITORING") {
    try {
      ensureSupportedPage();
      startMonitoring(message.config);
      sendResponse({ status: "ok" });
    } catch (error) {
      sendResponse({
        status: "error",
        error: error instanceof Error ? error.message : "Failed to start monitoring"
      });
    }
    return false;
  }

  if (message?.type === "STOP_COLLECTION") {
    COLLECTION_LOCK.stopRequested = true;
    sendResponse({ status: "ok" });
    return false;
  }

  if (message?.type === "STOP_MONITORING") {
    try {
      const result = stopMonitoring(message.config);
      sendResponse(result);
    } catch (error) {
      sendResponse({
        status: "error",
        error: error instanceof Error ? error.message : "Failed to stop monitoring"
      });
    }
    return false;
  }

  return false;
});

function startMonitoring(config) {
  MONITOR_STATE.postMap.clear();
  collectVisiblePosts(MONITOR_STATE.postMap);

  MONITOR_STATE.observer = new MutationObserver((mutations) => {
    const hasNewArticles = mutations.some(m =>
      Array.from(m.addedNodes).some(n =>
        n instanceof Element && (
          n.matches('article[data-testid="tweet"]') ||
          n.querySelector?.('article[data-testid="tweet"]')
        )
      )
    );
    if (!hasNewArticles) return;

    let added = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        const articles = node.matches('article[data-testid="tweet"]')
          ? [node]
          : [...node.querySelectorAll('article[data-testid="tweet"]')];
        for (const article of articles) {
          const post = extractPostFromArticle(article);
          if (!post) continue;
          if (!MONITOR_STATE.postMap.has(post.postId)) {
            MONITOR_STATE.postMap.set(post.postId, post);
            added = true;
          }
        }
      }
    }
    if (added) {
      chrome.runtime.sendMessage({
        type: "MONITOR_PROGRESS",
        scannedCount: MONITOR_STATE.postMap.size
      });
    }
  });

  const timelineTarget = document.querySelector('[data-testid="primaryColumn"]') || document.body;
  MONITOR_STATE.observer.observe(timelineTarget, { childList: true, subtree: true });
}

function stopMonitoring(config) {
  if (MONITOR_STATE.observer) {
    MONITOR_STATE.observer.disconnect();
    MONITOR_STATE.observer = null;
  }
  const candidatePosts = Array.from(MONITOR_STATE.postMap.values());
  const thresholds = config?.thresholds ?? { minScore: 10000 };
  const fallbackLimit = config?.fallbackLimit ?? 10;
  const popularPosts = sortPostsByPopularity(
    candidatePosts.filter((post) => passesThreshold(post, thresholds))
  );
  const usedFallback = popularPosts.length === 0 && candidatePosts.length > 0;
  const displayedPosts = usedFallback
    ? buildFallbackPosts(candidatePosts, fallbackLimit)
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

async function collectPopularLinkPosts(config) {
  ensureSupportedPage();

  const savedScrollY = window.scrollY;

  COLLECTION_LOCK.stopRequested = false;

  const postMap = new Map();
  collectVisiblePosts(postMap);

  const SCROLL_PX = 60;
  const TICK_MS = 100;
  const COLLECT_EVERY = 14; // collect visible posts every 14 ticks (~1.4s)

  const totalScrollPx = Math.max(window.innerHeight * 0.9, 700) * config.maxScrolls;
  const totalTicks = Math.ceil(totalScrollPx / SCROLL_PX);
  const totalCollections = Math.ceil(totalTicks / COLLECT_EVERY);

  let stoppedEarly = false;

  await new Promise((resolve) => {
    let tick = 0;
    let collectionsDone = 0;

    const interval = setInterval(() => {
      if (COLLECTION_LOCK.stopRequested) {
        clearInterval(interval);
        stoppedEarly = true;
        resolve();
        return;
      }

      window.scrollBy({ top: SCROLL_PX, behavior: "instant" });
      tick++;

      if (tick % COLLECT_EVERY === 0) {
        collectVisiblePosts(postMap);
        collectionsDone++;

        const currentPosts = sortPostsByPopularity(
          Array.from(postMap.values()).filter((post) => passesThreshold(post, config.thresholds))
        );
        chrome.runtime.sendMessage({
          type: "COLLECTION_PROGRESS",
          scrollIndex: collectionsDone,
          totalScrolls: totalCollections,
          posts: currentPosts,
          scannedCount: postMap.size
        });
      }

      if (tick >= totalTicks) {
        clearInterval(interval);
        resolve();
      }
    }, TICK_MS);
  });

  collectVisiblePosts(postMap);

  const candidatePosts = Array.from(postMap.values());
  const popularPosts = sortPostsByPopularity(
    candidatePosts.filter((post) => passesThreshold(post, config.thresholds))
  );
  const usedFallback = popularPosts.length === 0 && candidatePosts.length > 0;
  const displayedPosts = usedFallback
    ? buildFallbackPosts(candidatePosts, config.fallbackLimit)
    : popularPosts;

  window.scrollTo({ top: savedScrollY, behavior: "instant" });

  return {
    status: "ok",
    stoppedEarly,
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
    createdAt,
    images: extractImages(article),
    repostBy: extractRepostContext(article)
  };
}

function extractImages(article) {
  const imgs = article.querySelectorAll('[data-testid="tweetPhoto"] img');
  return [...imgs]
    .map(img => img.src.replace(/name=[^&]+/, "name=small"))
    .filter(Boolean)
    .slice(0, 4);
}

function extractRepostContext(article) {
  const ctx = article.querySelector('[data-testid="socialContext"]');
  if (!ctx) return null;
  const text = ctx.textContent?.trim() ?? "";
  if (!text.includes("Repost") && !text.includes("Retweeted")) return null;
  const anchor = ctx.querySelector("a[href]");
  const profileUrl = anchor ? normalizeUrl(anchor.getAttribute("href")) : null;
  return { label: text, profileUrl };
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
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      continue;
    }
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

function calculateScore(post) {
  return post.likeCount * 1 + post.repostCount * 3 + post.replyCount * 2;
}

function passesThreshold(post, thresholds) {
  return calculateScore(post) >= thresholds.minScore;
}

function sortPostsByPopularity(posts) {
  return [...posts].sort((a, b) => calculateScore(b) - calculateScore(a));
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
