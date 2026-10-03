import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppProvider } from './lib/store.jsx';
import App from './App.jsx';
import { registerServiceWorker } from './lib/install.js';

import './styles/theme.css';
import './styles/app.css';
import './styles/motion.css';

registerServiceWorker();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
