using System;
using System.Runtime.InteropServices;

namespace WFMarketTrends.Helpers;

internal static class NativeMethods
{
    internal const uint NoActivate = 0x10, NoSize = 1, NoMove = 2, FrameChanged = 0x20;
    internal static readonly nint Topmost = new(-1);
    [StructLayout(LayoutKind.Sequential)] internal struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] internal struct Rect
    {
        public int Left, Top, Right, Bottom;
        public readonly int Width => Right - Left;
        public readonly int Height => Bottom - Top;
        public readonly bool Contains(Point p) => p.X >= Left && p.X < Right && p.Y >= Top && p.Y < Bottom;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct MonitorInfo
    {
        public uint Size;
        public Rect Monitor, Work;
        public uint Flags;
    }
    [DllImport("user32.dll")] internal static extern uint GetDpiForWindow(nint hwnd);
    [StructLayout(LayoutKind.Sequential)] internal struct MouseData
    {
        public Point Position;
        public uint Mouse, Flags, Time;
        public nuint Extra;
    }
    internal delegate nint MouseProc(int code, nuint message, nint data);
    [DllImport("user32.dll", SetLastError = true)] internal static extern nint SetWindowsHookExW(int type, MouseProc callback, nint module, uint thread);
    [DllImport("user32.dll")] internal static extern bool UnhookWindowsHookEx(nint hook);
    [DllImport("user32.dll")] internal static extern nint CallNextHookEx(nint hook, int code, nuint message, nint data);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] internal static extern nint GetModuleHandle(string? name);
    [DllImport("user32.dll")] internal static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] internal static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] internal static extern bool IsWindowVisible(nint hwnd);
    [DllImport("user32.dll")] internal static extern nint MonitorFromPoint(Point point, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern bool GetMonitorInfo(nint monitor, ref MonitorInfo info);
    [DllImport("user32.dll", SetLastError = true)] internal static extern bool SetWindowPos(nint hwnd, nint after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] internal static extern bool GetWindowRect(nint hwnd, out Rect rect);
    [DllImport("user32.dll")] internal static extern nint GetWindowLongPtrW(nint hwnd, int index);
    [DllImport("user32.dll")] internal static extern nint SetWindowLongPtrW(nint hwnd, int index, nint value);
}
