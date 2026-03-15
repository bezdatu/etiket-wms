import { Outlet, NavLink } from 'react-router-dom';
import { Home, ScanLine, Package, History, MapPin } from 'lucide-react';
import { clsx } from 'clsx';

export const Layout = () => {
  return (
    <div className="flex flex-col h-screen bg-background text-text overflow-hidden font-sans">
      {/* Header */}
      <header className="flex-none bg-surface border-b border-slate-700/50 p-4 sticky top-0 z-10 backdrop-blur-md">
        <div className="flex justify-between items-center max-w-lg mx-auto w-full">
          <h1 className="text-xl font-bold bg-gradient-to-r from-primary-400 to-primary-600 bg-clip-text text-transparent">
            PartSense WMS
          </h1>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto w-full max-w-lg mx-auto p-4 mb-20 scroll-smooth">
        <Outlet />
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 w-full bg-surface/90 backdrop-blur-xl border-t border-slate-700/50 pb-safe z-50">
        <div className="flex justify-around items-center h-16 max-w-lg mx-auto px-2">
          <NavLink to="/" className={({ isActive }) => clsx("flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors", isActive ? "text-primary-500" : "text-muted hover:text-text")}>
            <Home size={20} />
            <span className="text-[10px] font-medium uppercase tracking-wider">Главная</span>
          </NavLink>
          <NavLink to="/catalog" className={({ isActive }) => clsx("flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors", isActive ? "text-primary-500" : "text-muted hover:text-text")}>
            <Package size={20} />
            <span className="text-[10px] font-medium uppercase tracking-wider">Каталог</span>
          </NavLink>
          
          {/* Center Scan FAB */}
          <div className="relative -top-5 flex justify-center items-center">
            <NavLink to="/scan" className={({ isActive }) => clsx("flex items-center justify-center w-14 h-14 rounded-full shadow-lg shadow-primary-500/20 text-white transition-all transform active:scale-95", isActive ? "bg-primary-500 scale-105" : "bg-primary-600 hover:bg-primary-500")}>
              <ScanLine size={24} />
            </NavLink>
          </div>

          <NavLink to="/history" className={({ isActive }) => clsx("flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors", isActive ? "text-primary-500" : "text-muted hover:text-text")}>
            <History size={20} />
            <span className="text-[10px] font-medium uppercase tracking-wider">История</span>
          </NavLink>
          <NavLink to="/locations" className={({ isActive }) => clsx("flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors", isActive ? "text-primary-500" : "text-muted hover:text-text")}>
            <MapPin size={20} />
            <span className="text-[10px] font-medium uppercase tracking-wider">Места</span>
          </NavLink>
        </div>
      </nav>
    </div>
  );
};
