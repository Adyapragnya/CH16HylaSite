import { useState, useCallback } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './routes/ProtectedRoute'
import Shell from './components/Shell'
import LoginPage from './pages/LoginPage'
import SplashScreen from './pages/SplashScreen'

export default function App() {
  // Show splash only on the very first load of this browser session
  const [showSplash, setShowSplash] = useState(
    () => !sessionStorage.getItem('ch16_splash_done')
  )

  const handleSplashDone = useCallback(() => {
    sessionStorage.setItem('ch16_splash_done', '1')
    setShowSplash(false)
  }, [])

  return (
    <AuthProvider>
      {showSplash && <SplashScreen onDone={handleSplashDone} />}
      <BrowserRouter>
        <Toaster position="top-right" richColors closeButton />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/*" element={
            <ProtectedRoute>
              <Shell />
            </ProtectedRoute>
          } />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
