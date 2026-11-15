import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useOffline } from '../context/OfflineContext';
import NotificationCenter from '../components/NotificationCenter';
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  Building2,
  CalendarDays,
  CalendarCheck,
  ShieldAlert,
  CreditCard,
  Award,
  QrCode,
  ScanLine,
  ClipboardCheck,
  History,
  BarChart3,
  TrendingUp,
  BrainCircuit,
  FileSpreadsheet,
  CloudOff,
  Cloud,
  RefreshCw,
  LogOut,
  Menu,
  X,
  School,
  MessageSquare,
  Heart,
  FileBadge,
  ShieldCheck,
  Archive,
} from 'lucide-react';

export default function DashboardLayout() {
  const { user, isAdmin, logout } = useAuth();
  const { isOnline, pendingCount, isSyncing, syncPendingQueue } = useOffline();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = user?.role === 'PARENT'
    ? [
        { label: 'Guardian Dashboard', path: '/parent/dashboard', icon: LayoutDashboard },
        { label: 'Academic Performance', path: '/performance', icon: TrendingUp },
        { label: 'Student Documents', path: '/documents', icon: FileBadge },
        { label: 'Certificates Register', path: '/certificates', icon: Award },
        { label: 'Transfer Certificates', path: '/students/tc', icon: FileBadge },
        { label: 'School Communication', path: '/parent/communication', icon: MessageSquare },
        { label: 'Academic Calendar', path: '/calendar', icon: CalendarDays },
        { label: 'School Timetable', path: '/timetable', icon: CalendarDays },
      ]
    : isAdmin
    ? [
        { label: 'Admin Dashboard', path: '/admin/dashboard', icon: LayoutDashboard },
        { label: 'Student Directory', path: '/students', icon: GraduationCap },
        { label: 'Student Promotion', path: '/students/promotion', icon: GraduationCap },
        { label: 'Class Management', path: '/classes', icon: Building2 },
        { label: 'Faculty Management', path: '/teachers', icon: Users },
        { label: 'Parent & Guardians', path: '/parents/manage', icon: Heart },
        { label: 'Student Documents', path: '/documents', icon: FileBadge },
        { label: 'Certificates Register', path: '/certificates', icon: Award },
        { label: 'Transfer Certificates', path: '/students/tc', icon: FileBadge },
        { label: 'School Communication', path: '/parent/communication', icon: MessageSquare },
        { label: 'School Timetable', path: '/timetable', icon: CalendarDays },
        { label: 'Academic Calendar', path: '/calendar', icon: CalendarDays },
        { label: 'Examinations & Marks', path: '/exams', icon: Award },
        { label: 'Academic Performance', path: '/performance', icon: TrendingUp },
        { label: 'Student Leaves', path: '/leaves', icon: CalendarCheck },
        { label: 'Discipline & Incidents', path: '/incidents', icon: ShieldAlert },
        { label: 'Fee & Billing', path: '/fees', icon: CreditCard },
        { label: 'Fee Rollover & Archive', path: '/fees/rollover', icon: Archive },
        { label: 'QR ID Cards', path: '/qr-cards', icon: QrCode },
        { label: 'Attendance Reports', path: '/reports', icon: BarChart3 },
        { label: 'Attendance Intelligence', path: '/attendance/analytics', icon: TrendingUp },
        { label: 'Visual Analytics', path: '/analytics', icon: TrendingUp },
        { label: 'AI Insights & Anomaly', path: '/ai-insights', icon: BrainCircuit },
        { label: 'AI Report Generator', path: '/ai-reports', icon: FileSpreadsheet },
        { label: 'Offline Sync Center', path: '/sync', icon: CloudOff, badge: pendingCount },
        { label: 'System Administration', path: '/admin/system', icon: ShieldCheck },
      ]
    : [
        { label: 'Teacher Dashboard', path: '/teacher/dashboard', icon: LayoutDashboard },
        { label: 'QR Live Scanner', path: '/attendance/scan', icon: ScanLine },
        { label: 'Manual Register', path: '/attendance/manual', icon: ClipboardCheck },
        { label: 'Attendance History', path: '/attendance/history', icon: History },
        { label: 'Student Documents', path: '/documents', icon: FileBadge },
        { label: 'Certificates Register', path: '/certificates', icon: Award },
        { label: 'Weekly Timetable', path: '/timetable', icon: CalendarDays },
        { label: 'Academic Calendar', path: '/calendar', icon: CalendarDays },
        { label: 'Exams & Marks Entry', path: '/exams', icon: Award },
        { label: 'Academic Performance', path: '/performance', icon: TrendingUp },
        { label: 'Student Leaves', path: '/leaves', icon: CalendarCheck },
        { label: 'Discipline & Incidents', path: '/incidents', icon: ShieldAlert },
        { label: 'Fee & Billing', path: '/fees', icon: CreditCard },
        { label: 'School Communication', path: '/parent/communication', icon: MessageSquare },
        { label: 'Class Reports', path: '/reports', icon: BarChart3 },
        { label: 'Attendance Intelligence', path: '/attendance/analytics', icon: TrendingUp },
        { label: 'Offline Sync Center', path: '/sync', icon: CloudOff, badge: pendingCount },
      ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      {/* Mobile Top Header */}
      <header className="md:hidden bg-slate-900 text-white px-4 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center font-bold text-white shadow">
            ST
          </div>
          <div>
            <span className="font-bold tracking-tight text-base">ShikshaTrack</span>
            <span className="block text-[10px] text-slate-400">Rural Education Portal</span>
          </div>
        </div>
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800"
        >
          {sidebarOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>

      {/* Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-slate-900 text-slate-200 transform transition-transform duration-200 ease-in-out md:translate-x-0 md:static md:flex md:flex-col shadow-xl ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-0 hidden md:flex'
        }`}
      >
        {/* Brand Logo & Name */}
        <div className="p-5 border-b border-slate-800 flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 to-sky-400 flex items-center justify-center font-bold text-white text-xl shadow-lg shadow-sky-900/30">
            ST
          </div>
          <div>
            <h1 className="font-bold text-lg text-white tracking-tight leading-none">ShikshaTrack</h1>
            <p className="text-xs text-sky-400 font-medium mt-1">Smart School System</p>
          </div>
        </div>

        {/* User Context Widget */}
        <div className="px-4 py-3 m-3 rounded-xl bg-slate-800/80 border border-slate-700/60 flex items-center space-x-3">
          <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center text-sky-400 font-semibold border border-slate-600">
            {user?.name?.charAt(0) || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-white truncate">{user?.name}</p>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-950 text-sky-300 border border-sky-800">
              {user?.role}
            </span>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-sky-600 text-white font-semibold shadow-md shadow-sky-900/40'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <Icon size={18} className={isActive ? 'text-white' : 'text-slate-400'} />
                  <span>{item.label}</span>
                </div>
                {item.badge > 0 && (
                  <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-amber-500 text-slate-950 shadow">
                    {item.badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* School Footer & Sign Out */}
        <div className="p-4 border-t border-slate-800/80 bg-slate-950/40">
          <div className="flex items-center space-x-2 text-xs text-slate-400 mb-3">
            <School size={14} className="text-slate-500 shrink-0" />
            <span className="truncate">{user?.school?.name || 'Rural Model School'}</span>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center space-x-2 px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-red-950/50 hover:text-red-300 text-slate-300 border border-slate-700/60 transition"
          >
            <LogOut size={14} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Desktop Navbar */}
        <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between sticky top-0 z-30 shadow-xs">
          <div className="flex items-center space-x-4">
            <div className="text-sm font-medium text-slate-600 flex items-center space-x-2">
              <span className="font-semibold text-slate-800">{user?.school?.name}</span>
              <span className="text-slate-300">|</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                Code: {user?.school?.code || 'RAV-01'}
              </span>
            </div>
          </div>

          {/* Right Status Actions */}
          <div className="flex items-center space-x-3">
            {/* Notification Center */}
            <NotificationCenter />

            {/* Online / Offline Indicator */}
            <div
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                isOnline
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-amber-50 text-amber-700 border-amber-300 animate-pulse'
              }`}
            >
              {isOnline ? (
                <>
                  <Cloud size={14} className="text-emerald-600" />
                  <span>Online</span>
                </>
              ) : (
                <>
                  <CloudOff size={14} className="text-amber-600" />
                  <span>Offline (Cached)</span>
                </>
              )}
            </div>

            {/* Offline Sync Trigger Badge */}
            {pendingCount > 0 && (
              <button
                onClick={syncPendingQueue}
                disabled={isSyncing || !isOnline}
                className="flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-50 shadow-sm transition"
                title="Synchronize offline attendance scans"
              >
                <RefreshCw size={13} className={isSyncing ? 'animate-spin' : ''} />
                <span>{isSyncing ? 'Syncing...' : `Sync Queue (${pendingCount})`}</span>
              </button>
            )}
          </div>
        </header>

        {/* Render Page Content */}
        <main className="flex-1 p-6 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

