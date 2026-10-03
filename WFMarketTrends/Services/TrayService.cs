using System;
using System.Drawing;
using System.Windows.Forms;
using Microsoft.UI.Dispatching;

namespace WFMarketTrends.Services;

internal sealed class TrayService : IDisposable
{
    private readonly NotifyIcon _icon;
    private readonly ContextMenuStrip _menu = new();
    public TrayService(DispatcherQueue queue, Action show, Action hide, Action settings, Action exit)
    {
        void Add(string label, Action action) => _menu.Items.Add(label, null, (_, _) => queue.TryEnqueue(() => action()));
        Add("Show Market Trends", show); Add("Hide", hide); Add("Settings", settings);
        _menu.Items.Add(new ToolStripSeparator()); Add("Exit", exit);
        _icon = new NotifyIcon { Text = "Warframe Market Trends", Icon = SystemIcons.Application, ContextMenuStrip = _menu, Visible = true };
        _icon.DoubleClick += (_, _) => queue.TryEnqueue(() => show());
    }
    public void Dispose() { _icon.Visible = false; _icon.Dispose(); _menu.Dispose(); }
}
