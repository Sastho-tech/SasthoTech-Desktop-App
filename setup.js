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
        <div class="status-row">
            <span id="${id}-status" class="status">Waiting to start...</span>
            <span id="${id}-percentage" class="percentage">0%</span>
        </div>
    `;
    progressList.appendChild(progressItem);
}

function updateProgress(id, progress, status) {
    const progressElement = document.getElementById(`${id}-progress`);
    const statusElement = document.getElementById(`${id}-status`);
    const percentageElement = document.getElementById(`${id}-percentage`);

    progressElement.style.width = `${progress}%`;
    statusElement.textContent = status;
    percentageElement.textContent = `${Math.round(progress)}%`;

    // Add a subtle animation effect
    progressElement.style.transition = 'width 0.5s ease-in-out';

    // Change color for warnings
    if (status.startsWith('Warning:')) {
        statusElement.style.color = '#f39c12';
    } else {
        statusElement.style.color = '';
    }
}

startSetupBtn.addEventListener('click', () => {
    startSetupBtn.disabled = true;
    startSetupBtn.textContent = 'Setting up...';
    startSetupBtn.style.opacity = '0.7';
    ipcRenderer.send('stop-all-servers');
    ipcRenderer.send('start-setup');
});

ipcRenderer.on('create-progress-items', (event, items) => {
    items.forEach(item => createProgressItem(item.id, item.name));
});

ipcRenderer.on('update-progress', (event, { id, progress, status }) => {
    updateProgress(id, progress, status);
});

ipcRenderer.on('setup-complete', () => {
    ipcRenderer.send('start-all-server');
    const completeMessage = document.createElement('div');
    completeMessage.innerHTML = `
        <h3 style="color: #27ae60;">Setup Complete!</h3>
        <p>Your hospital management system is now ready to use.</p>
        <button id="closeSetupBtn" style="
            background: linear-gradient(to right, #3498db, #2980b9);
            color: white;
            border: none;
            padding: 10px 20px;
            font-size: 1rem;
            border-radius: 25px;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            margin-top: 1rem;
        ">Close Setup</button>
    `;
    progressList.appendChild(completeMessage);
//    close setup button
    document.getElementById('closeSetupBtn').addEventListener('click', () => {
        ipcRenderer.send('close-setup-window');
    });
});

ipcRenderer.on('setup-error', (event, { id, error }) => {
    const statusElement = document.getElementById(`${id}-status`);
    const percentageElement = document.getElementById(`${id}-percentage`);
    
    statusElement.textContent = `Error: ${error}`;
    statusElement.style.color = '#e74c3c';
    
    percentageElement.textContent = 'Failed';
    percentageElement.style.color = '#e74c3c';

    // Add a retry button
    const retryButton = document.createElement('button');
    retryButton.textContent = 'Retry';
    retryButton.style.marginLeft = '10px';
    retryButton.onclick = () => {
        ipcRenderer.send('retry-setup', id);
        statusElement.textContent = 'Retrying...';
        statusElement.style.color = '';
        percentageElement.textContent = '0%';
        percentageElement.style.color = '';
        retryButton.remove();
    };
    statusElement.parentNode.appendChild(retryButton);
});