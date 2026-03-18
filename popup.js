const onboardingSection = document.getElementById("onboarding");
const controlsSection = document.getElementById("controls");
const openHomeButton = document.getElementById("open-home-button");
const collectButton = document.getElementById("collect-button");
const monitorButton = document.getElementById("monitor-button");
const statusNode = document.getElementById("status");
const summaryNode = document.getElementById("summary");
const resultsList = document.getElementById("results-list");
const minScoreInput = document.getElementById("min-score");
const linksOnlyCheckbox = document.getElementById("links-only");
const sortSelect = document.getElementById("sort-select");
const resultsCount = document.getElementById("results-count");
const exportBtn = document.getElementById("export-btn");

let isMonitoring = false;
let isCollecting = false;
let lastResults = [];

// ── Tab check & onboarding ──
chrome.runtime.sendMessage({ type: "CHECK_TAB" }, (response) => {
  if (response?.supported) {
    onboardingSection.setAttribute("hidden", "");
    controlsSection.removeAttribute("hidden");
  } else {
    onboardingSection.removeAttribute("hidden");
    controlsSection.setAttribute("hidden", "");
  }
});

openHomeButton.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://x.com/home" });
});

// ── Settings restore ──
chrome.storage.local.get(["minScore", "linksOnly", "sortBy"], (result) => {
  if (result.minScore != null) {
    minScoreInput.value = result.minScore;
  }
  if (result.linksOnly != null) {
    linksOnlyCheckbox.checked = result.linksOnly;
  }
  if (result.sortBy != null) {
    sortSelect.value = result.sortBy;
  }
});

minScoreInput.addEventListener("change", () => {
  const value = Number(minScoreInput.value);
  chrome.storage.local.set({ minScore: value });
});

linksOnlyCheckbox.addEventListener("change", () => {
  chrome.storage.local.set({ linksOnly: linksOnlyCheckbox.checked });
  renderResults(lastResults);
});

sortSelect.addEventListener("change", () => {
  chrome.storage.local.set({ sortBy: sortSelect.value });
  renderResults(lastResults);
});

exportBtn.addEventListener("click", async () => {
  const filtered = linksOnlyCheckbox.checked
    ? lastResults.filter((item) => item.externalUrl)
    : lastResults;
  const sorted = sortItems(filtered);

  const header = "Handle\tText\tLikes\tReposts\tReplies\tScore\tPostURL\tExternalURL";
  const rows = sorted.map(item => {
    const text = (item.text || "").replace(/[\t\n\r]/g, " ").slice(0, 100);
    const score = calcScore(item);
    return `${item.authorHandle}\t${text}\t${item.likeCount}\t${item.repostCount}\t${item.replyCount}\t${score}\t${item.postUrl}\t${item.externalUrl || ""}`;
  });
  const tsv = [header, ...rows].join("\n");

  try {
    await navigator.clipboard.writeText(tsv);
    const original = exportBtn.textContent;
    exportBtn.textContent = `${sorted.length} posts exported!`;
    setTimeout(() => { exportBtn.textContent = original; }, 2000);
  } catch {
    exportBtn.textContent = "Failed";
    setTimeout(() => { exportBtn.textContent = "Export"; }, 2000);
  }
});

function getThresholdsConfig() {
  return { thresholds: { minScore: Number(minScoreInput.value) } };
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "COLLECTION_PROGRESS") {
    setStatus(`Scrolling... (${message.scrollIndex}/${message.totalScrolls})`, "loading");
    summaryNode.textContent = `Scanned ${message.scannedCount} posts, found ${message.posts.length} so far...`;
    if (message.posts.length > 0) {
      lastResults = message.posts;
      renderResults(message.posts);
    }
  } else if (message?.type === "MONITOR_PROGRESS") {
    summaryNode.textContent = `Monitoring... ${message.scannedCount} posts captured so far.`;
  }
});

collectButton.addEventListener("click", async () => {
  if (isCollecting) {
    collectButton.textContent = "Stopping...";
    collectButton.disabled = true;
    await chrome.runtime.sendMessage({ type: "STOP_COLLECTION" });
    return;
  }

  isCollecting = true;
  collectButton.textContent = "Stop";
  setStatus("Auto-scrolling and collecting posts...", "loading");
  summaryNode.textContent = "";
  renderResults([]);

  try {
    const response = await chrome.runtime.sendMessage({ type: "START_COLLECTION", config: getThresholdsConfig() });
    const statusText = response?.stoppedEarly ? "Collection stopped." : "Collection finished.";
    handleCollectionResponse(response, statusText);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Collection failed.", "error");
    summaryNode.textContent = "";
    renderResults([]);
  } finally {
    isCollecting = false;
    collectButton.textContent = "Collect Now";
    collectButton.disabled = false;
  }
});

monitorButton.addEventListener("click", async () => {
  if (!isMonitoring) {
    isMonitoring = true;
    monitorButton.textContent = "Stop & Show";
    monitorButton.classList.add("active");
    setStatus("Monitoring... Scroll the timeline.", "loading");
    renderResults([]);
    await chrome.runtime.sendMessage({ type: "START_MONITORING", config: getThresholdsConfig() });
  } else {
    isMonitoring = false;
    monitorButton.disabled = true;
    monitorButton.textContent = "Start Monitoring";
    monitorButton.classList.remove("active");
    setStatus("Processing results...", "loading");
    try {
      const response = await chrome.runtime.sendMessage({ type: "STOP_MONITORING", config: getThresholdsConfig() });
      handleCollectionResponse(response);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Collection failed.", "error");
      summaryNode.textContent = "";
      renderResults([]);
    } finally {
      monitorButton.disabled = false;
      monitorButton.classList.remove("active");
    }
  }
});

function handleCollectionResponse(response, statusText = "Collection finished.") {
  if (!response || response.status !== "ok") {
    throw new Error(response?.error ?? "Collection failed.");
  }

  const popularPosts = response.popularPosts ?? response.items ?? [];
  lastResults = popularPosts;
  chrome.storage.session.set({
    lastSession: {
      results: popularPosts,
      scannedCount: response.scannedCount,
      matchedCount: response.matchedCount,
      usedFallback: response.usedFallback,
      displayedCount: response.displayedCount,
      timestamp: Date.now()
    }
  }, () => {
    if (chrome.runtime.lastError) {
      console.warn("Failed to save session:", chrome.runtime.lastError.message);
    }
  });
  setStatus(statusText, "success");
  summaryNode.textContent = response.usedFallback
    ? `Scanned ${response.scannedCount} posts. No posts met the threshold, so showing the top ${response.displayedCount} fallback posts.`
    : `Scanned ${response.scannedCount} posts, found ${response.matchedCount} popular posts.`;
  renderResults(popularPosts);
}

chrome.storage.session.get("lastSession", (data) => {
  if (data.lastSession?.results?.length) {
    lastResults = data.lastSession.results;
    const s = data.lastSession;
    summaryNode.textContent = s.usedFallback
      ? `Scanned ${s.scannedCount} posts. Showing top ${s.displayedCount} fallback posts.`
      : `Scanned ${s.scannedCount} posts, found ${s.matchedCount} popular posts.`;
    setStatus("Previous results restored.", "success");
    renderResults(lastResults);
  } else {
    renderResults([]);
  }
});


function setStatus(message, tone) {
  statusNode.textContent = message;
  statusNode.className = `status ${tone}`;
}

function showPreview(item) {
  const el = document.getElementById("post-preview");
  el.innerHTML = "";

  const backBtn = document.createElement("button");
  backBtn.className = "preview-back";
  backBtn.textContent = "← Back";
  backBtn.addEventListener("click", hidePreview);
  el.append(backBtn);

  if (item.repostBy) {
    const repost = document.createElement("p");
    repost.className = "repost-context";
    if (item.repostBy.profileUrl) {
      const link = document.createElement("a");
      link.href = item.repostBy.profileUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = `↻ ${item.repostBy.label}`;
      repost.append(link);
    } else {
      repost.textContent = `↻ ${item.repostBy.label ?? item.repostBy}`;
    }
    el.append(repost);
  }

  const meta = document.createElement("p");
  meta.className = "result-meta";
  const nameSpan = document.createElement("span");
  nameSpan.textContent = item.authorName;
  const handleSpan = document.createElement("span");
  handleSpan.className = "handle";
  handleSpan.textContent = item.authorHandle;
  meta.append(nameSpan, handleSpan);
  if (item.externalUrl) {
    const linkBadge = document.createElement("span");
    linkBadge.className = "link-badge";
    linkBadge.textContent = "Link";
    meta.append(linkBadge);
  }

  const text = document.createElement("p");
  text.className = "result-text";
  text.textContent = item.text || "(No text content)";

  const footer = document.createElement("div");
  footer.className = "result-footer";
  footer.append(
    createScoreBadge(item),
    metricBadge("♡", item.likeCount),
    metricBadge("↻", item.repostCount),
    metricBadge("◯", item.replyCount)
  );

  const links = document.createElement("div");
  links.className = "result-links";
  if (item.externalUrl) {
    const externalLink = document.createElement("a");
    externalLink.className = "result-link";
    externalLink.href = item.externalUrl;
    externalLink.target = "_blank";
    externalLink.rel = "noreferrer";
    externalLink.textContent = item.externalUrl;
    links.append(externalLink);
  }
  const postLink = document.createElement("a");
  postLink.className = "result-link post-link";
  postLink.href = item.postUrl;
  postLink.target = "_blank";
  postLink.rel = "noreferrer";
  postLink.textContent = "View post →";
  links.append(postLink);

  const copyActions = document.createElement("div");
  copyActions.className = "copy-actions";
  copyActions.append(createCopyButton(item.postUrl, "Copy URL"));
  if (item.externalUrl) {
    copyActions.append(createCopyButton(item.externalUrl, "Copy Link"));
  }
  links.append(copyActions);

  if (item.images?.length) {
    const imageGrid = document.createElement("div");
    imageGrid.className = "result-images";
    for (const src of item.images) {
      const img = document.createElement("img");
      img.src = src.replace("name=small", "name=medium");
      img.alt = "";
      img.loading = "lazy";
      imageGrid.append(img);
    }
    el.append(meta, text, imageGrid, footer, links);
  } else {
    el.append(meta, text, footer, links);
  }

  el.removeAttribute("hidden");
}

function hidePreview() {
  document.getElementById("post-preview").setAttribute("hidden", "");
}

function renderResults(items) {
  resultsList.innerHTML = "";

  const filtered = linksOnlyCheckbox.checked
    ? items.filter((item) => item.externalUrl)
    : items;

  const sorted = sortItems(filtered);
  resultsCount.textContent = `${sorted.length} posts`;
  exportBtn.disabled = sorted.length === 0;

  if (!sorted.length) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "empty-state";
    emptyItem.textContent = items.length > 0
      ? "No link posts found. Try turning off \"Links only\"."
      : "No popular posts found.";
    resultsList.append(emptyItem);
    return;
  }

  for (const item of sorted) {
    const entry = document.createElement("li");

    entry.addEventListener("click", () => showPreview(item));

    if (item.repostBy) {
      const repost = document.createElement("p");
      repost.className = "repost-context";
      repost.textContent = `↻ ${item.repostBy.label ?? item.repostBy}`;
      entry.append(repost);
    }

    const meta = document.createElement("p");
    meta.className = "result-meta";
    const nameSpan = document.createElement("span");
    nameSpan.textContent = item.authorName;
    const handleSpan = document.createElement("span");
    handleSpan.className = "handle";
    handleSpan.textContent = item.authorHandle;
    meta.append(nameSpan, handleSpan);
    if (item.isFallback) {
      const badge = document.createElement("span");
      badge.className = "fallback-badge";
      badge.textContent = "Fallback";
      meta.append(badge);
    }
    if (item.externalUrl) {
      const linkBadge = document.createElement("span");
      linkBadge.className = "link-badge";
      linkBadge.textContent = "Link";
      meta.append(linkBadge);
    }

    const text = document.createElement("p");
    text.className = "result-text";
    text.textContent = item.text || "(No text content)";

    const footer = document.createElement("div");
    footer.className = "result-footer";
    footer.append(
      createScoreBadge(item),
      metricBadge("♡", item.likeCount),
      metricBadge("↻", item.repostCount),
      metricBadge("◯", item.replyCount)
    );

    const links = document.createElement("div");
    links.className = "result-links";

    if (item.externalUrl) {
      const externalLink = document.createElement("a");
      externalLink.className = "result-link";
      externalLink.href = item.externalUrl;
      externalLink.target = "_blank";
      externalLink.rel = "noreferrer";
      externalLink.textContent = item.externalUrl;
      links.append(externalLink);
    }

    const postLink = document.createElement("a");
    postLink.className = "result-link post-link";
    postLink.href = item.postUrl;
    postLink.target = "_blank";
    postLink.rel = "noreferrer";
    postLink.textContent = "View post →";
    links.append(postLink);

    const copyActions = document.createElement("div");
    copyActions.className = "copy-actions";
    copyActions.append(createCopyButton(item.postUrl, "Copy URL"));
    if (item.externalUrl) {
      copyActions.append(createCopyButton(item.externalUrl, "Copy Link"));
    }
    links.append(copyActions);

    if (item.images?.length) {
      const imageGrid = document.createElement("div");
      imageGrid.className = "result-images";
      for (const src of item.images) {
        const img = document.createElement("img");
        img.src = src;
        img.alt = "";
        img.loading = "lazy";
        imageGrid.append(img);
      }
      entry.append(meta, text, imageGrid, footer, links);
    } else {
      entry.append(meta, text, footer, links);
    }
    resultsList.append(entry);
  }
}

function calcScore(item) {
  return item.likeCount * 1 + item.repostCount * 3 + item.replyCount * 2;
}

function createScoreBadge(item) {
  const score = calcScore(item);
  const badge = document.createElement("span");
  badge.className = "score-badge";
  if (score >= 500) badge.classList.add("tier-hot");
  else if (score >= 100) badge.classList.add("tier-warm");
  else badge.classList.add("tier-normal");
  badge.textContent = score.toLocaleString();
  return badge;
}

function sortItems(items) {
  const mode = sortSelect.value;
  return [...items].sort((a, b) => {
    if (mode === "likes") return b.likeCount - a.likeCount;
    if (mode === "newest") return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
    return calcScore(b) - calcScore(a);
  });
}

function metricBadge(icon, count) {
  const node = document.createElement("span");
  node.className = "metric";
  const iconSpan = document.createElement("span");
  iconSpan.className = "metric-icon";
  iconSpan.textContent = icon;
  const countSpan = document.createElement("span");
  countSpan.textContent = count.toLocaleString();
  node.append(iconSpan, countSpan);
  return node;
}

function createCopyButton(textToCopy, label) {
  const btn = document.createElement("button");
  btn.className = "copy-btn";
  btn.textContent = label;
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(textToCopy);
      btn.textContent = "Copied!";
      btn.classList.add("copy-success");
      setTimeout(() => {
        btn.textContent = label;
        btn.classList.remove("copy-success");
      }, 1500);
    } catch {
      btn.textContent = "Failed";
      setTimeout(() => { btn.textContent = label; }, 1500);
    }
  });
  return btn;
}
