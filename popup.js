const collectButton = document.getElementById("collect-button");
const statusNode = document.getElementById("status");
const summaryNode = document.getElementById("summary");
const resultsList = document.getElementById("results-list");

collectButton.addEventListener("click", async () => {
  setLoadingState(true);
  setStatus("Collecting visible and scrolled posts...", "loading");
  summaryNode.textContent = "";
  renderResults([]);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "START_COLLECTION"
    });

    if (!response || response.status !== "ok") {
      throw new Error(response?.error ?? "Collection failed.");
    }

    setStatus("Collection finished.", "success");
    summaryNode.textContent = `Scanned ${response.scannedCount} posts, matched ${response.matchedCount}.`;
    renderResults(response.items);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Collection failed.", "error");
    summaryNode.textContent = "";
    renderResults([]);
  } finally {
    setLoadingState(false);
  }
});

renderResults([]);

function setLoadingState(isLoading) {
  collectButton.disabled = isLoading;
  collectButton.textContent = isLoading ? "Collecting..." : "Collect Now";
}

function setStatus(message, tone) {
  statusNode.textContent = message;
  statusNode.className = `status ${tone}`;
}

function renderResults(items) {
  resultsList.innerHTML = "";

  if (!items.length) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "empty-state";
    emptyItem.textContent = "No results yet.";
    resultsList.append(emptyItem);
    return;
  }

  for (const item of items) {
    const entry = document.createElement("li");

    const meta = document.createElement("p");
    meta.className = "result-meta";
    meta.textContent = `${item.authorName} ${item.authorHandle}`;

    const text = document.createElement("p");
    text.className = "result-text";
    text.textContent = item.text || "(No text content)";

    const externalLink = document.createElement("a");
    externalLink.className = "result-link";
    externalLink.href = item.externalUrl;
    externalLink.target = "_blank";
    externalLink.rel = "noreferrer";
    externalLink.textContent = item.externalUrl;

    const footer = document.createElement("div");
    footer.className = "result-footer";
    footer.append(
      metricBadge(`Likes ${item.likeCount}`),
      metricBadge(`Reposts ${item.repostCount}`),
      metricBadge(`Replies ${item.replyCount}`)
    );

    const postLink = document.createElement("a");
    postLink.className = "result-link";
    postLink.href = item.postUrl;
    postLink.target = "_blank";
    postLink.rel = "noreferrer";
    postLink.textContent = "Open post";

    entry.append(meta, text, externalLink, footer, postLink);
    resultsList.append(entry);
  }
}

function metricBadge(text) {
  const node = document.createElement("span");
  node.textContent = text;
  return node;
}
