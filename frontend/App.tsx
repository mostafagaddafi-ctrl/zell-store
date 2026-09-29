import { Route, Routes } from 'react-router-dom'
import Admin from './pages/Admin'
import ProductDetail from './pages/ProductDetail'
import Store from './pages/Store'
import './styles/rtl.css'
import './appTheme.css'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Store />} />
      <Route path="/product/:productId" element={<ProductDetail />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="*" element={<Store />} />
    </Routes>
  )
}
