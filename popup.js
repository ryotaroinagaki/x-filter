const DEFAULT_MIN_RAW_SCORE = 10000;

const inlineFilterCheckbox = document.getElementById("inline-filter");
const minScoreInput = document.getElementById("min-score");
const userHandleInput = document.getElementById("user-handle");
const userThresholdInput = document.getElementById("user-threshold");
const addUserBtn = document.getElementById("add-user-btn");
const userThresholdList = document.getElementById("user-threshold-list");
const emptyHint = document.getElementById("empty-hint");

inlineFilterCheckbox.addEventListener("change", () => {
  void storageLocalSet({ inlineFilterEnabled: inlineFilterCheckbox.checked });
});

minScoreInput.addEventListener("change", () => {
  const minScore = normalizeMinRawScore(minScoreInput.value);
  minScoreInput.value = String(minScore);
  void storageLocalSet({ minScore });
});

addUserBtn.addEventListener("click", () => {
  void addUserThreshold();
});

userHandleInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    void addUserThreshold();
  }
});

void initialize();

async function initialize() {
  const result = await storageLocalGet(["inlineFilterEnabled", "minScore", "userThresholds"]);
  inlineFilterCheckbox.checked = Boolean(result.inlineFilterEnabled);
  minScoreInput.value = String(normalizeMinRawScore(result.minScore));
  renderUserThresholds(result.userThresholds ?? {});
}

async function addUserThreshold() {
  const raw = userHandleInput.value.trim();
  if (!raw) {
    return;
  }

  const handle = raw.startsWith("@") ? raw : `@${raw}`;
  const threshold = normalizeMinRawScore(userThresholdInput.value);

  const result = await storageLocalGet(["userThresholds"]);
  const thresholds = result.userThresholds ?? {};
  thresholds[handle] = threshold;

  await storageLocalSet({ userThresholds: thresholds });
  renderUserThresholds(thresholds);

  userHandleInput.value = "";
  userThresholdInput.value = "0";
}

async function removeUserThreshold(handle) {
  const result = await storageLocalGet(["userThresholds"]);
  const thresholds = result.userThresholds ?? {};
  delete thresholds[handle];

  await storageLocalSet({ userThresholds: thresholds });
  renderUserThresholds(thresholds);
}

function renderUserThresholds(thresholds) {
  userThresholdList.innerHTML = "";
  const entries = Object.entries(thresholds);

  emptyHint.hidden = entries.length > 0;

  for (const [handle, value] of entries) {
    const li = document.createElement("li");
    li.className = "user-threshold-item";

    const handleSpan = document.createElement("span");
    handleSpan.className = "user-handle";
    handleSpan.textContent = handle;

    const valueSpan = document.createElement("span");
    valueSpan.className = "user-value";
    valueSpan.textContent = value === 0 ? "常に表示" : String(value);

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-user-btn";
    removeBtn.textContent = "削除";
    removeBtn.addEventListener("click", () => {
      void removeUserThreshold(handle);
    });

    li.append(handleSpan, valueSpan, removeBtn);
    userThresholdList.append(li);
  }
}

function normalizeMinRawScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return DEFAULT_MIN_RAW_SCORE;
  }
  return Math.round(numeric);
}

function storageLocalGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result);
    });
  });
}

function storageLocalSet(value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(value, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}
