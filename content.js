function getSelectionData() {
  const selection = window.getSelection();

  if (!selection || selection.isCollapsed) {
    return null;
  }

  const text = selection.toString().trim();

  if (!text) {
    return null;
  }

  return {
    text,
    title: document.title,
    url: window.location.href
  };
}

document.addEventListener("dblclick", async () => {
  const data = getSelectionData();

  if (!data) return;

  try {
    await navigator.clipboard.writeText(data.text);
  } catch (_) {}

  chrome.storage.local.set({
    pendingShare: {
      type: "SELECTION",
      text: data.text,
      title: data.title,
      url: data.url,
      timestamp: Date.now()
    }
  });
});

document.addEventListener("mouseup", () => {
  setTimeout(() => {
    const data = getSelectionData();

    if (!data) return;

    chrome.storage.local.set({
      pendingShare: {
        type: "SELECTION",
        text: data.text,
        title: data.title,
        url: data.url,
        timestamp: Date.now()
      }
    });
  }, 50);
});