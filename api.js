const axios = require('axios');
const { ipcRenderer } = require('electron');
const { readSync } = require('original-fs');
require('dotenv').config();
async function login(email, password) {
  try {
    const response = await axios.post(`${process.env.SERVER_URL}/auth/login`, {
      email,
      password
    });
    console.log(response.data, 'login Data')
    // if(response.data){
    //   ipcRenderer.send('save-login-data', response.data.data);
    // }
    return response.data
    // Extract the token from the response cookies
   
  } catch (error) {
    console.error('Login failed:', error.message);
    throw error;
  }
}

// Create an axios instance with interceptors to include the token in future requests
const api = axios.create({
  baseURL: 'http://localhost:5001/api/v1'
});

api.interceptors.request.use(async (config) => {
  // Request the token from the main process
  const token = await ipcRenderer.invoke('get-token');
  if (token) {
    config.headers['Cookie'] = `token=${token}`;
  }
  return config;
});

module.exports = { login, api };