import { StrictMode } from 'react';
import { createRoot }  from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { APP_VERSION } from './buildVersion.js';

console.info(`[Zax & Miggy Poker] build ${APP_VERSION}`);

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>
);
