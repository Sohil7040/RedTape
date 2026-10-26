import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'
import './styles/workspace.css'
import { editor } from './core/store'

if (import.meta.env.DEV) {
  ;(window as unknown as { __corelith: typeof editor }).__corelith = editor
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
