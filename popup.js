const collectButton = document.getElementById("collect-button");
const monitorButton = document.getElementById("monitor-button");
const statusNode = document.getElementById("status");
const summaryNode = document.getElementById("summary");
const resultsList = document.getElementById("results-list");

let isMonitoring = false;
let isCollecting = false;

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "COLLECTION_PROGRESS") {
    setStatus(`Scrolling... (${message.scrollIndex}/${message.totalScrolls})`, "loading");
    summaryNode.textContent = `Scanned ${message.scannedCount} posts, found ${message.posts.length} so far...`;
    if (message.posts.length > 0) renderResults(message.posts);
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
    const response = await chrome.runtime.sendMessage({ type: "START_COLLECTION" });
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
    await chrome.runtime.sendMessage({ type: "START_MONITORING" });
  } else {
    isMonitoring = false;
    monitorButton.disabled = true;
    monitorButton.textContent = "Start Monitoring";
    monitorButton.classList.remove("active");
    setStatus("Processing results...", "loading");
    try {
      const response = await chrome.runtime.sendMessage({ type: "STOP_MONITORING" });
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
  setStatus(statusText, "success");
  summaryNode.textContent = response.usedFallback
    ? `Scanned ${response.scannedCount} posts. No posts met the threshold, so showing the top ${response.displayedCount} fallback posts.`
    : `Scanned ${response.scannedCount} posts, found ${response.matchedCount} popular posts.`;
  renderResults(popularPosts);
}

renderResults([]);


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

  const text = document.createElement("p");
  text.className = "result-text";
  text.textContent = item.text || "(No text content)";

  const footer = document.createElement("div");
  footer.className = "result-footer";
  footer.append(
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

  if (!items.length) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "empty-state";
    emptyItem.textContent = "No popular posts found.";
    resultsList.append(emptyItem);
    return;
  }

  for (const item of items) {
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

    const text = document.createElement("p");
    text.className = "result-text";
    text.textContent = item.text || "(No text content)";

    const footer = document.createElement("div");
    footer.className = "result-footer";
    footer.append(
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
