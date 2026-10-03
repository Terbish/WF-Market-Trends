using System;
using System.Diagnostics;
using System.ComponentModel;
using System.Runtime.InteropServices;
using WFMarketTrends.Helpers;
using Microsoft.UI.Dispatching;

namespace WFMarketTrends.Services;

internal sealed class MouseEdgeService : IDisposable
{
    private readonly WindowService _window;
    private readonly DispatcherQueue _queue;
    private readonly NativeMethods.MouseProc _callback;
    private readonly nint _hook;
    private bool _disposed;
    private readonly DispatcherQueueTimer _timer;
    private readonly PointerLeaveState _leave = new();
    private readonly Stopwatch _dwell = new();
    private bool _armed = true;
    private long _lastGeometry;

    public MouseEdgeService(WindowService window, DispatcherQueue queue)
    {
        _window = window;
        _queue = queue;
        _timer = queue.CreateTimer();
        _timer.Interval = TimeSpan.FromMilliseconds(25);
        _timer.Tick += (_, _) => Poll();
        _callback = MouseHook;
        _hook = NativeMethods.SetWindowsHookExW(14, _callback, NativeMethods.GetModuleHandle(null), 0);
        if (_hook == 0) throw new Win32Exception(Marshal.GetLastWin32Error(), "Mouse click monitoring could not start.");
        _timer.Start();
    }

    private void Poll()
    {
        // Re-read geometry after display/DPI changes, without interrupting a slide.
        if (Environment.TickCount64 - _lastGeometry > 2000 && !_window.IsAnimating)
        {
            _window.RefreshGeometry();
            _lastGeometry = Environment.TickCount64;
        }
        if (!NativeMethods.GetCursorPos(out var point)) return;
        if (_leave.ShouldHide(_window.RevealVersion, _window.IsRevealed, _window.ContainsCursor(point), _window.IsAnimating, _window.SuspendAutoHide))
            _window.Hide();
        bool atEdge = _window.IsAtActivationEdge(point);
        if (!atEdge) { _dwell.Reset(); _armed = true; return; }
        if (_window.IsRevealed || !_armed) { _dwell.Reset(); return; }
        if (!_dwell.IsRunning) _dwell.Start();
        if (_dwell.ElapsedMilliseconds < 150) return;
        _armed = false;
        _dwell.Reset();
        _window.Show();
        _leave.ShouldHide(_window.RevealVersion, true, true, true, false);
    }

    private nint MouseHook(int code, nuint message, nint data)
    {
        if (code >= 0 && message is 0x201 or 0x204 or 0x207 or 0x20B)
        {
            var point = Marshal.PtrToStructure<NativeMethods.MouseData>(data).Position;
            int version = _window.RevealVersion;
            // Latch clicks synchronously so the next cursor poll cannot hide an activated panel.
            if (_leave.ShouldHide(version, _window.IsRevealed, _window.ContainsCursor(point), _window.IsAnimating, _window.SuspendAutoHide, clicked: true))
                _queue.TryEnqueue(() =>
                {
                    if (!_disposed && version == _window.RevealVersion) _window.Hide();
                });
        }
        return NativeMethods.CallNextHookEx(_hook, code, message, data);
    }

    public void Dispose()
    {
        _disposed = true;
        _timer.Stop();
        NativeMethods.UnhookWindowsHookEx(_hook);
        GC.KeepAlive(_callback);
    }
}
