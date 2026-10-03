using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using WFMarketTrends.Helpers;
using WFMarketTrends.Models;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;

namespace WFMarketTrends.Services;

internal sealed class WindowService : IDisposable
{
    private readonly Window _window;
    private readonly nint _hwnd;
    private readonly AppSettings _settings;
    private readonly DispatcherQueueTimer _animation;
    private readonly Stopwatch _clock = new();
    private int _x, _width, _height, _y, _from, _to;
    public bool IsRevealed { get; private set; }
    public int RevealVersion { get; private set; }
    public bool SuspendAutoHide { get; set; }
    public bool IsAnimating => _animation.IsRunning;
    public NativeMethods.Rect Monitor { get; private set; }

    public WindowService(Window window, AppSettings settings)
    {
        _window = window;
        _settings = settings;
        _hwnd = WinRT.Interop.WindowNative.GetWindowHandle(window);
        var presenter = (OverlappedPresenter)window.AppWindow.Presenter;
        presenter.SetBorderAndTitleBar(false, false);
        presenter.IsResizable = presenter.IsMaximizable = presenter.IsMinimizable = false;
        presenter.IsAlwaysOnTop = true;
        window.AppWindow.IsShownInSwitchers =
#if SMOKE_TEST
            true;
#else
            false;
#endif
        long style = NativeMethods.GetWindowLongPtrW(_hwnd, -20).ToInt64();
#if SMOKE_TEST
        NativeMethods.SetWindowLongPtrW(_hwnd, -20, new nint((style | 0x40000L) & ~0x80L));
#else
        NativeMethods.SetWindowLongPtrW(_hwnd, -20, new nint((style | 0x80) & ~0x40000L));
#endif
        NativeMethods.SetWindowPos(_hwnd, NativeMethods.Topmost, 0, 0, 0, 0,
            NativeMethods.NoMove | NativeMethods.NoSize | NativeMethods.NoActivate | NativeMethods.FrameChanged);
        _animation = window.DispatcherQueue.CreateTimer();
        _animation.Interval = TimeSpan.FromMilliseconds(16);
        _animation.Tick += (_, _) => Animate();
        RefreshGeometry();
    }

    // All primary-monitor selection and physical-pixel geometry lives here.
    public void RefreshGeometry()
    {
        var info = new NativeMethods.MonitorInfo { Size = (uint)Marshal.SizeOf<NativeMethods.MonitorInfo>() };
        if (!NativeMethods.GetMonitorInfo(NativeMethods.MonitorFromPoint(default, 1), ref info)) return;
        double scale = Math.Max(96, NativeMethods.GetDpiForWindow(_hwnd)) / 96.0;
        var (x, width, height) = PanelLayout.Calculate(info.Monitor.Left, info.Monitor.Width, info.Monitor.Height, scale, _settings);
        if (Monitor.Equals(info.Monitor) && width == _width && height == _height && x == _x) return;
        Monitor = info.Monitor;
        _width = width;
        _height = height;
        _x = x;
        _animation.Stop();
        Move(IsRevealed ? Monitor.Top : Monitor.Top - _height);
    }

    public void Show(bool focus = false)
    {
        if (!IsRevealed)
        {
            IsRevealed = true;
            RevealVersion++;
            _window.AppWindow.Show(false);
            Begin(Monitor.Top);
        }
        if (focus) _window.Activate();
    }

    public void Hide()
    {
        if (!IsRevealed) return;
        IsRevealed = false;
        Begin(Monitor.Top - _height);
    }

    private void Begin(int destination)
    {
        _from = _y;
        _to = destination;
        _clock.Restart();
        _animation.Start();
    }

    private void Animate()
    {
        double progress = Math.Min(1, _clock.Elapsed.TotalMilliseconds / 250);
        double eased = IsRevealed ? 1 - Math.Pow(1 - progress, 3) : progress * progress * progress;
        Move((int)Math.Round(_from + (_to - _from) * eased));
        if (progress < 1) return;
        _animation.Stop();
        if (!IsRevealed) _window.AppWindow.Hide(); // Keep WebView alive, avoid painting on a monitor above primary.
    }

    private void Move(int y)
    {
        _y = y;
        NativeMethods.SetWindowPos(_hwnd, NativeMethods.Topmost, _x, y, _width, _height, NativeMethods.NoActivate);
    }

    public bool ContainsCursor(NativeMethods.Point point) =>
        IsRevealed && NativeMethods.GetWindowRect(_hwnd, out var rect) && rect.Contains(point);

    public bool IsAtActivationEdge(NativeMethods.Point point) =>
        point.X >= _x && point.X < _x + _width && point.Y >= Monitor.Top && point.Y < Monitor.Top + 5;

    public void Dispose() => _animation.Stop();
}
