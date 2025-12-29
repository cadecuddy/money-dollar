// popup.js
(async () => {
    'use strict';

    const api = typeof browser !== 'undefined' ? browser : chrome;
    const TOGGLE_STORAGE_KEY = 'moneyDollarEnabled';
    const ACTIVE_ICON = 'assets/active.png';
    const INACTIVE_ICON = 'assets/inactive.png';

    const toggleBtn = document.getElementById('toggleBtn');
    const toggleIcon = document.getElementById('toggleIcon');
    const statusText = document.getElementById('statusText');

    async function getState() {
        const result = await api.storage.local.get([TOGGLE_STORAGE_KEY]);
        return result[TOGGLE_STORAGE_KEY] !== false;
    }

    async function setState(enabled) {
        await api.storage.local.set({ [TOGGLE_STORAGE_KEY]: enabled });
    }

    function updateUI(enabled) {
        if (enabled) {
            toggleIcon.src = ACTIVE_ICON;
            statusText.textContent = 'ACTIVE';
            statusText.style.color = '#4CAF50';
        } else {
            toggleIcon.src = INACTIVE_ICON;
            statusText.textContent = 'INACTIVE';
            statusText.style.color = '#FF0000';
        }
    }

    async function notifyContentScripts(enabled) {
        try {
            const tabs = await api.tabs.query({});
            for (const tab of tabs) {
                try {
                    await api.tabs.sendMessage(tab.id, {
                        type: 'TOGGLE_STATE',
                        enabled: enabled
                    });
                } catch (error) {
                }
            }
        } catch (error) {
            console.error('Error notifying content scripts:', error);
        }
    }

    toggleBtn.addEventListener('click', async () => {
        const currentState = await getState();
        const newState = !currentState;

        await setState(newState);
        updateUI(newState);
        await notifyContentScripts(newState);
    });

    (async () => {
        const enabled = await getState();
        updateUI(enabled);
    })();
})();

