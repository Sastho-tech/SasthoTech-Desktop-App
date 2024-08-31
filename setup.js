
const { ipcRenderer } = require('electron');

const startSetupBtn = document.getElementById('startSetupBtn');
const progressList = document.getElementById('progressList');

function createProgressItem(id, name) {
    const progressItem = document.createElement('div');
    progressItem.className = 'progress-item';
    progressItem.innerHTML = `
        <h3>${name}</h3>
        <div class="progress-bar">
            <div id="${id}-progress" class="progress-fill"></div>
        </div>
        <p id="${id}-status" class="status">Waiting...</p>
    `;
    progressList.appendChild(progressItem);
}

function updateProgress(id, progress, status) {
    document.getElementById(`${id}-progress`).style.width = `${progress}%`;
    document.getElementById(`${id}-status`).textContent = status;
}

startSetupBtn.addEventListener('click', () => {
    startSetupBtn.style.display = 'none';
    ipcRenderer.send('start-setup');
});

ipcRenderer.on('create-progress-items', (event, items) => {
    items.forEach(item => createProgressItem(item.id, item.name));
});

ipcRenderer.on('update-progress', (event, { id, progress, status }) => {
    updateProgress(id, progress, status);
});

ipcRenderer.on('setup-complete', () => {
    const completeMessage = document.createElement('p');
    completeMessage.textContent = 'Setup complete! You can now close this window.';
    completeMessage.style.fontWeight = 'bold';
    completeMessage.style.marginTop = '1rem';
    progressList.appendChild(completeMessage);
});