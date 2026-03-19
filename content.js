const SUPPORTED_HOSTS = new Set(["x.com", "twitter.com"]);

// ── Post extraction ──

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

  const metrics = extractMetrics(article);
  const rawScore = calculateScoreFromMetrics(metrics);
  const authorHandle = extractHandleFromPostUrl(postUrl);

  return {
    postId,
    postUrl,
    authorName: extractAuthorName(article, authorHandle),
    authorHandle,
    text: extractText(article),
    externalUrl: extractExternalUrl(article),
    likeCount: metrics.likes,
    repostCount: metrics.reposts,
    replyCount: metrics.replies,
    rawScore,
    createdAt: article.querySelector("time")?.getAttribute("datetime") ?? null,
    images: extractImages(article),
    repostBy: extractRepostContext(article)
  };
}

function findPostAnchor(article) {
  const anchors = article.querySelectorAll('a[href*="/status/"]');
  for (const anchor of anchors) {
    const href = anchor.getAttribute("href");
    if (href && /\/status\/\d+/.test(href)) {
      return anchor;
    }
  }
  return null;
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

  const buttons = article.querySelectorAll("[data-testid]");
  for (const button of buttons) {
    const metricName = metricMap[button.getAttribute("data-testid")];
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
  return article.querySelector('[data-testid="tweetText"]')?.innerText?.trim() ?? "";
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

function extractImages(article) {
  const imgs = article.querySelectorAll('[data-testid="tweetPhoto"] img');
  return [...imgs]
    .map((img) => img.src.replace(/name=[^&]+/, "name=small"))
    .filter(Boolean)
    .slice(0, 4);
}

function extractRepostContext(article) {
  const ctx = article.querySelector('[data-testid="socialContext"]');
  if (!ctx) {
    return null;
  }
  const text = ctx.textContent?.trim() ?? "";
  if (!text.includes("Repost") && !text.includes("Retweeted")) {
    return null;
  }
  const anchor = ctx.querySelector("a[href]");
  const profileUrl = anchor ? normalizeUrl(anchor.getAttribute("href")) : null;
  return { label: text, profileUrl };
}

function extractPostId(postUrl) {
  return postUrl.match(/\/status\/(\d+)/)?.[1] ?? null;
}

// ── Score calculation ──

function getRawScore(post) {
  if (Number.isFinite(post?.rawScore)) {
    return post.rawScore;
  }
  return calculateScoreFromMetrics(post);
}

function calculateScoreFromMetrics(metrics) {
  return (metrics.likeCount ?? metrics.likes ?? 0)
    + (metrics.repostCount ?? metrics.reposts ?? 0) * 3
    + (metrics.replyCount ?? metrics.replies ?? 0) * 2;
}

// ── Utilities ──

function normalizeUrl(input) {
  return new URL(input, window.location.origin).toString();
}

function normalizeExternalValue(value) {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function normalizeHandle(handle) {
  if (typeof handle !== "string") {
    return null;
  }
  const trimmed = handle.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
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

// ── Inline Timeline Filter ──

const INLINE_FILTER_STATE = {
  enabled: false,
  observer: null,
  minScore: 10000,
  userThresholds: {},
  evaluatedArticles: new WeakSet(),
  styleInjected: false
};

function injectFilterStyle() {
  if (INLINE_FILTER_STATE.styleInjected) {
    return;
  }
  const style = document.createElement("style");
  style.textContent = ".x-filter-hidden { display: none !important; }";
  document.head.appendChild(style);
  INLINE_FILTER_STATE.styleInjected = true;
}

function evaluateAndHideArticle(article) {
  if (INLINE_FILTER_STATE.evaluatedArticles.has(article)) {
    return;
  }
  INLINE_FILTER_STATE.evaluatedArticles.add(article);

  const post = extractPostFromArticle(article);
  if (!post) {
    return;
  }

  if (post.rawScore === 0 && post.likeCount === 0 && post.repostCount === 0 && post.replyCount === 0) {
    return;
  }

  const handle = normalizeHandle(post.authorHandle);
  const userThreshold = handle ? INLINE_FILTER_STATE.userThresholds[handle] : undefined;

  if (userThreshold === 0) {
    return;
  }

  const threshold = userThreshold !== undefined ? userThreshold : INLINE_FILTER_STATE.minScore;

  if (post.rawScore < threshold) {
    const cell = article.closest('div[data-testid="cellInnerDiv"]');
    if (cell) {
      cell.classList.add("x-filter-hidden");
    }
  }
}

function applyInlineFilter() {
  INLINE_FILTER_STATE.evaluatedArticles = new WeakSet();

  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  for (const article of articles) {
    const cell = article.closest('div[data-testid="cellInnerDiv"]');
    if (cell) {
      cell.classList.remove("x-filter-hidden");
    }
    evaluateAndHideArticle(article);
  }
}

function startInlineFilter(minScore, userThresholds) {
  injectFilterStyle();
  INLINE_FILTER_STATE.enabled = true;
  INLINE_FILTER_STATE.minScore = minScore;
  INLINE_FILTER_STATE.userThresholds = userThresholds || {};
  INLINE_FILTER_STATE.evaluatedArticles = new WeakSet();

  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  for (const article of articles) {
    evaluateAndHideArticle(article);
  }

  INLINE_FILTER_STATE.observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) {
          continue;
        }
        const articles = node.matches('article[data-testid="tweet"]')
          ? [node]
          : [...node.querySelectorAll('article[data-testid="tweet"]')];
        for (const article of articles) {
          evaluateAndHideArticle(article);
        }
      }
    }
  });

  const target = document.querySelector('[data-testid="primaryColumn"]') || document.body;
  INLINE_FILTER_STATE.observer.observe(target, { childList: true, subtree: true });
}

function stopInlineFilter() {
  INLINE_FILTER_STATE.enabled = false;

  if (INLINE_FILTER_STATE.observer) {
    INLINE_FILTER_STATE.observer.disconnect();
    INLINE_FILTER_STATE.observer = null;
  }

  const hiddenCells = document.querySelectorAll(".x-filter-hidden");
  for (const cell of hiddenCells) {
    cell.classList.remove("x-filter-hidden");
  }

  INLINE_FILTER_STATE.evaluatedArticles = new WeakSet();
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes.inlineFilterEnabled) {
    if (changes.inlineFilterEnabled.newValue) {
      const minScore = INLINE_FILTER_STATE.minScore;
      const userThresholds = INLINE_FILTER_STATE.userThresholds;
      if (!INLINE_FILTER_STATE.enabled) {
        startInlineFilter(minScore, userThresholds);
      }
    } else {
      stopInlineFilter();
    }
  }

  if (changes.minScore && INLINE_FILTER_STATE.enabled) {
    INLINE_FILTER_STATE.minScore = changes.minScore.newValue;
    applyInlineFilter();
  }

  if (changes.userThresholds && INLINE_FILTER_STATE.enabled) {
    INLINE_FILTER_STATE.userThresholds = changes.userThresholds.newValue ?? {};
    applyInlineFilter();
  }
});

chrome.storage.local.get(["inlineFilterEnabled", "minScore", "userThresholds"], (result) => {
  if (result.minScore !== undefined) {
    INLINE_FILTER_STATE.minScore = result.minScore;
  }
  if (result.userThresholds !== undefined) {
    INLINE_FILTER_STATE.userThresholds = result.userThresholds;
  }
  if (result.inlineFilterEnabled) {
    startInlineFilter(INLINE_FILTER_STATE.minScore, INLINE_FILTER_STATE.userThresholds);
  }
});
