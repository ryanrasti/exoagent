import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { Challenge } from './Challenge'
import { DatabaseDumpDemo } from './DatabaseDumpDemo'
import { Landing } from './Landing'
import { Terms } from './Terms'
import './index.css'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/challenge" element={<Challenge />} />
        <Route path="/demo" element={<DatabaseDumpDemo />} />
        <Route path="/terms" element={<Terms />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
