chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true
  }).catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true
  }).catch(console.error);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open-teamconnect") return;

  try {
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tabs.length || !tabs[0].windowId) return;

    await chrome.sidePanel.open({
      windowId: tabs[0].windowId
    });
  } catch (error) {
    console.error("TeamConnect shortcut error:", error);
  }
});