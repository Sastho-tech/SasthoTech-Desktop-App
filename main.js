const { app, BrowserWindow, ipcMain,session } = require('electron');
const path = require('path');
const { fork,exec,spawn } = require('child_process');
const axios = require('axios');
const fs = require('fs-extra');
const { pipeline } = require('stream');
const { promisify } = require('util');
const { login, api } = require('./api');
const AdmZip = require('adm-zip');
const util = require('util');
const { autoUpdater } = require("electron-updater");
// const open = require('open');/

const execPromise = util.promisify(exec);
require('dotenv').config();

const streamPipeline = promisify(pipeline);

let mainWindow;
let servers = {};
let loginData = null;
let chromeProcess = null;
const processes = [
  {
    name: 'synchronizer',
    scriptPath: path.join('C:', 'SasthoTech', 'Synchronizer', 'bundle.js'),
    workingDir: 'C:\\SasthoTech\\Synchronizer',
    setupPath: 'C:\\SasthoTech\\Synchronizer\\setup.bat',
  },
  {
    name: 'backend',
    scriptPath: path.join('C:', 'SasthoTech', 'Backend', 'sasthotech-hospital-backend-v1.cjs'),
    workingDir: 'C:\\SasthoTech\\Backend',
    setupPath: 'C:\\SasthoTech\\Backend\\setup.bat',
  },
  {
   name: 'frontend',
   scriptPath: path.join('C:', 'SasthoTech', 'Frontend', 'server.js'),
   workingDir: 'C:\\SasthoTech\\Frontend',
   setupPath: 'C:\\SasthoTech\\Frontend\\setup.bat',
  }
];

const API_BASE_URL = 'http://localhost:5001';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: path.join(__dirname, 'icon.ico'), // Use .ico for Windows
  });

  mainWindow.loadFile('index.html');
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}
function createSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 600,
    height: 400,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  setupWindow.loadFile('setup.html');
}

async function runSetup(processToRun = null) {
  const processesToSetup = processToRun ? [processToRun] : processes;
  setupWindow.webContents.send('create-progress-items', processes.map(p => ({ id: p.name, name: p.name })));

  for (const process of processesToSetup) {
    try {
      setupWindow.webContents.send('update-progress', {
        id: process.name,
        progress: 0,
        status: 'Initializing setup...'
      });

      await new Promise((resolve, reject) => {
        const setupProcess = spawn(process.setupPath, [], { 
          cwd: process.workingDir,
          shell: true
        });

        let output = '';
        let currentProgress = 0;

        setupProcess.stdout.on('data', (data) => {
          output += data.toString();
          console.log(`${process.name} setup stdout:`, data.toString());
          
          // Simulate progress based on output
          currentProgress += 10;
          if (currentProgress > 90) currentProgress = 90;

          // Update progress and status based on output
          let status = 'Running setup...';
          if (output.includes('npm install')) status = 'Installing dependencies...';
          if (output.includes('npm run generate')) status = 'Generating files...';

          setupWindow.webContents.send('update-progress', {
            id: process.name,
            progress: currentProgress,
            status: status
          });
        });

        setupProcess.stderr.on('data', (data) => {
          console.error(`${process.name} setup stderr:`, data.toString());
          setupWindow.webContents.send('update-progress', {
            id: process.name,
            progress: currentProgress,
            status: 'Warning: ' + data.toString().trim()
          });
        });

        setupProcess.on('close', (code) => {
          if (code === 0) {
            setupWindow.webContents.send('update-progress', {
              id: process.name,
              progress: 100,
              status: 'Setup complete'
            });
            resolve();
          } else {
            reject(new Error(`${process.name} setup exited with code ${code}`));
          }
        });
      });

    } catch (error) {
      console.error(`Error during ${process.name} setup:`, error);
      setupWindow.webContents.send('update-progress', {
        id: process.name,
        progress: 100,
        status: 'Setup failed: ' + error.message
      });
      setupWindow.webContents.send('setup-error', {
        id: process.name,
        error: error.message
      });
    }
  }

  setupWindow.webContents.send('setup-complete');
}
ipcMain.handle('login', async (event, { email, password }) => {
  try {
    const result = await login(email, password);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
function startServer(name, scriptPath, workingDir) {
  if (!servers[name]) {
    console.log(`Starting ${name} server...`);
    console.log(`Script path: ${scriptPath}`);
    console.log(`Working directory: ${workingDir}`);

    const server = fork(scriptPath, [], {
      cwd: workingDir,
      // env: { ...process.env },
      stdio: 'pipe'
    });

    server.stdout.on('data', (data) => {
      console.log(`${name} stdout: ${data}`);
      mainWindow.webContents.send('process-status', { id: name, status: 'Running' });
    });

    server.stderr.on('data', (data) => {
      console.error(`${name} stderr: ${data}`);
    });

    server.on('exit', (code, signal) => {
      console.log(`${name} exited with code ${code} and signal ${signal}`);
      servers[name] = null;
      mainWindow.webContents.send('process-status', { id: name, status: 'Stopped' });
    });

    server.on('error', (err) => {
      console.error(`Failed to start ${name}:`, err);
      servers[name] = null;
      mainWindow.webContents.send('process-status', { id: name, status: 'Error' });
    });

    servers[name] = server;
    mainWindow.webContents.send('process-status', { id: name, status: 'Running' });
  }
}

function stopServer(name) {
  if (servers[name]) {
    servers[name].kill();
    servers[name] = null;
    mainWindow.webContents.send('process-status', { id: name, status: 'Stopped' });
  }
}

function stopAllServers() {
  Object.keys(servers).forEach(name => {
    stopServer(name);
  });
}
function startAllServers(){

  processes.forEach((process)=>{
    startServer(
      process.name,
      process.scriptPath,
      process.workingDir
    );

  })

}
async function getCurrentVersion(serverName) {
  try {
    const response = await api.get(`${API_BASE_URL}/api/v1/update/get-version/${serverName}`);
    console.log(response,serverName,'this') 
    return response.data.version;
  } catch (error) {
    console.error(`Error getting current version for ${serverName}:`, error);
    return null;
  }
}

async function checkForUpdates(serverName, currentVersion) {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/v1/update/check-updates/${serverName}/${currentVersion}`);
    return response.data;
  } catch (error) {
    console.error(`Error checking for updates for ${serverName}:`, error);
    return null;
  }
}

async function downloadUpdate(serverName, updateUrl) {
  try {
    const response = await axios({
      method: 'GET',
      url:API_BASE_URL+'/file/'+ updateUrl,
      responseType: 'stream'
    });

    const downloadPath = path.join('C:\\SasthoTech', `${serverName[0].toUpperCase()+serverName.slice(1)}-update.zip`);
    await streamPipeline(response.data, fs.createWriteStream(downloadPath));
    
    return downloadPath;
  } catch (error) {
    console.error(`Error downloading update for ${serverName}:`, error);
    return null;
  }
}
function extractUpdate(zipPath, serverName) {
  return new Promise(async (resolve, reject) => {
    try {
      const serverNameUpdated=`${serverName[0].toUpperCase()+serverName.slice(1)}`
      const zip = new AdmZip(zipPath);
      const extractPath = path.join('C:', 'SasthoTech', serverNameUpdated);
      const tempExtractPath = path.join('C:', 'SasthoTech', `${serverNameUpdated}_temp_${Date.now()}`);
      
      // Extract to a temporary directory
      zip.extractAllTo(tempExtractPath, true);

      // Stop the server before updating
      if (servers[serverName]) {
        console.log(`Stopping ${serverName} for update...`);
        servers[serverName].kill();
        servers[serverName] = null;
        // Wait a bit for the process to fully stop
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    // console.log(tempExtractPath,'temp path')
      // Copy files from temp directory to the actual directory
      await fs.copy(tempExtractPath, path.join('C:', 'SasthoTech'), { overwrite: true });
      const setupPath = path.join(extractPath, 'setup.bat');
      if (fs.existsSync(setupPath)) {
        console.log(`Running setup for ${serverName}...`);
        try {
          const { stdout, stderr } = await execPromise(setupPath, { cwd: extractPath });
          console.log(`Setup stdout: ${stdout}`);
          if (stderr) console.error(`Setup stderr: ${stderr}`);
        } catch (error) {
          console.error(`Error running setup for ${serverName}:`, error);
          // Decide whether to throw this error or continue with the update
        }
      } else {
        console.log(`No setup file found for ${serverName}`);
      }
      // Clean up
      await fs.remove(tempExtractPath);

      // cleaning downloaded zip
      await fs.unlink(zipPath);

      console.log(`Update completed for ${serverName}`);
      resolve({extractPath});
    } catch (error) {
      console.error(`Error extracting update for ${serverName}:`, error);
      reject(error);
    }
  });
}

app.whenReady().then(async() => {
  createWindow();
  
  try {
    const loginResult = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
    if (loginResult.message === 'Login successfully') {
      console.log('Auto-login successful');
      loginData = loginResult.data;
      // setTimeout(()=>{},2000)
    } else {
      console.error('Auto-login failed:', loginResult.message);
    }
  } catch (error) {
    console.error('Error during auto-login:', error);
    // Handle unexpected errors
  }
  startServer(
    'synchronizer',
    path.join('C:', 'SasthoTech', 'Synchronizer', 'bundle.js'),
    'C:\\SasthoTech\\Synchronizer'
  );

  startServer(
    'backend',
    path.join('C:', 'SasthoTech', 'Backend', 'sasthotech-hospital-backend-v1.cjs'),
    'C:\\SasthoTech\\Backend'
  );
  startServer(
    'frontend',
    path.join('C:', 'SasthoTech', 'Frontend', 'server.js'),
    'C:\\SasthoTech\\Frontend'
  );
 
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
app.on('quit', () => {
  // Clear the login data when the app is closed
  loginData = null;
});
app.on('exit', (event, exitCode) => {
  console.log(`App is exiting with code ${exitCode}`);
  stopAllServers();
});

// IPC handlers
ipcMain.on('get-current-version', async (event, serverName) => {
  const version = await getCurrentVersion(serverName);
  event.reply('current-version', { serverName, version });
});

ipcMain.on('check-for-updates', async (event, { serverName, currentVersion }) => {
  const updateInfo = await checkForUpdates(serverName, currentVersion);
  event.reply('update-check-result', { serverName, updateInfo });
});

ipcMain.on('download-update', async (event, { serverName, updateUrl }) => {
  stopServer(serverName)
  const downloadPath = await downloadUpdate(serverName, updateUrl);
  console.log(downloadPath,'downloadPath')
  if (downloadPath) {
    const {extractPath,backupPath} = await extractUpdate(downloadPath, serverName);
    console.log(`Update extracted to: ${extractPath}`);
    const processName = processes.find((s)=>s.name===serverName)
    if(processName){
      startServer(processName.name,processName.scriptPath,processName.workingDir)
    }
    event.reply('update-downloaded', { serverName, downloadPath });
  } else {
    event.reply('update-download-failed', { serverName });
  }
});

ipcMain.on('start-server', (event, name) => {
  if (name === 'synchronizer') {
    startServer(
      'synchronizer',
      path.join('C:', 'SasthoTech', 'Synchronizer', 'bundle.js'),
      'C:\\SasthoTech\\Synchronizer'
    );
  } else if (name === 'backend') {
    startServer(
      'backend',
      path.join('C:', 'SasthoTech', 'Backend', 'sasthotech-hospital-backend-v1.cjs'),
      'C:\\SasthoTech\\Backend'
    );
  }
  else if(name==="frontend"){
    startServer(
      'frontend',
      path.join('C:', 'SasthoTech', 'Frontend', 'server.js'),
      'C:\\SasthoTech\\Frontend'
    );
  }
});

ipcMain.on('stop-server', (event, name) => {
  stopServer(name);
});

ipcMain.on('stop-all-servers', (event) => {
  stopAllServers();
  event.reply('restart-status', 'All Servers stopped');
});
ipcMain.on('start-all-server',(event)=>{
  startAllServers()
  event.reply('restart-status','All Servers Started')
})

ipcMain.on('restart-system', (event) => {
  stopAllServers();
  setTimeout(() => {
    startServer(
      'synchronizer',
      path.join('C:', 'SasthoTech', 'Synchronizer', 'bundle.js'),
      'C:\\SasthoTech\\Synchronizer'
    );
    startServer(
      'backend',
      path.join('C:', 'SasthoTech', 'Backend', 'sasthotech-hospital-backend-v1.cjs'),
      'C:\\SasthoTech\\Backend'
    );
  }, 1000);
  event.reply('restart-status', 'Servers restarted');
});

ipcMain.on('update-system', (event) => {
  console.log('Update system requested');
  event.reply('update-status', 'Update completed');
});

ipcMain.on('get-server-status', (event) => {
  Object.keys(servers).forEach(name => {
    const status = servers[name] ? 'Running' : 'Stopped';
    event.reply('process-status', { id: name, status });
  });
});
ipcMain.on('save-token', async (event, token) => {
  const cookie = {
    url: 'http://localhost',
    name: 'token',
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production'
  };
  await session.defaultSession.cookies.set(cookie);
});
ipcMain.on('save-login-data', (event, data) => {
  console.log(data,'logiin data invoked')
  loginData = data;
});

ipcMain.handle('get-login-data', (event) => {
  return loginData;
});

ipcMain.handle('get-token', async () => {
  const cookies = await session.defaultSession.cookies.get({ name: 'token' });
  return cookies.length > 0 ? cookies[0].value : null;
});
ipcMain.on('launch-chrome', async () => {
  if (!chromeProcess) {
    const url = 'http://localhost:3000'; // Your frontend URL
    //  Alternate method using child_process (platform-specific)
    let command;
    if (process.platform === 'win32') {
      command = `start chrome ${url}`;
    } else if (process.platform === 'darwin') {
      command = `open -a "Google Chrome" ${url}`;
    } else {
      command = `google-chrome ${url}`;
    }
  
    exec(command, (error) => {
      if (error) {
        console.error(`Failed to open Chrome: ${error}`);
      }
    });}
});

ipcMain.on('check-chrome-status', (event) => {
  event.reply('chrome-status', chromeProcess !== null);
});
ipcMain.on('open-setup-window', () => {
  createSetupWindow();
});

ipcMain.on('start-setup', () => {
  runSetup();
});
async function checkForUpdates() {
  try {
    const response = await axios.get(`http://your-api-url/check-update/electron/${app.getVersion()}`);
    const updateInfo = response.data;

    if (updateInfo.hasUpdate) {
      mainWindow.webContents.send('app-update-available', updateInfo);
    } else {
      mainWindow.webContents.send('app-update-not-available');
    }
  } catch (error) {
    log.error('Error checking for updates:', error);
    mainWindow.webContents.send('app-update-error', error.message);
  }
}

ipcMain.on('download-update', async (event, updateInfo) => {
  try {
    const savePath = path.join(app.getPath('temp'), 'electron-update.exe');
    const writer = fs.createWriteStream(savePath);

    const response = await axios({
      url: updateInfo.downloadUrl,
      method: 'GET',
      responseType: 'stream'
    });

    response.data.pipe(writer);

    writer.on('finish', () => {
      mainWindow.webContents.send('app-update-downloaded');
    });

    writer.on('error', (err) => {
      log.error('Error downloading update:', err);
      mainWindow.webContents.send('app-update-error', 'Failed to download update');
    });
  } catch (error) {
    log.error('Error initiating update download:', error);
    mainWindow.webContents.send('app-update-error', 'Failed to initiate update download');
  }
});

ipcMain.on('quit-and-install', () => {
  const updateExePath = path.join(app.getPath('temp'), 'electron-update.exe');
  execFile(updateExePath, (err) => {
    if (err) {
      log.error('Failed to execute update:', err);
      mainWindow.webContents.send('app-update-error', 'Failed to execute update');
    }
    app.quit();
  });
});