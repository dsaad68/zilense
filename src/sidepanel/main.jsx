import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './panel.css'

// Fonts (Noto Sans SC / Noto Serif SC / Source Serif 4 variable) are self-hosted:
// index.html links ./fonts.css, which @font-faces the woff2 files vendored under
// src/sidepanel/fonts/ by `npm run fetch:fonts`. No remote stylesheet/font is
// loaded, so the extension has no external-CSS dependency (MV3-friendly).

createRoot(document.getElementById('root')).render(<App />)
