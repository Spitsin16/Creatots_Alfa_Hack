// Порядок стилей важен: токены кита → базовые стили приложения.
// Стили компонентов кита и CSS-модули экранов подключаются следом (через импорт App).
import '@alfalab/core-components/vars/index.css'
import './styles/base.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router'
import App from './App'
import { AuthProvider } from './auth'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } })

createRoot(document.getElementById('root')!).render(<StrictMode>
  <QueryClientProvider client={queryClient}><BrowserRouter><AuthProvider><App /></AuthProvider></BrowserRouter></QueryClientProvider>
</StrictMode>)
