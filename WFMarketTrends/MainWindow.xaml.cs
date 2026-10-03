using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using WFMarketTrends.Models;
using WFMarketTrends.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;

namespace WFMarketTrends;

public sealed partial class MainWindow : Window
{
    private const string Dashboard = "https://app.wfmarkettrends.local/index.html";
    private readonly SettingsService _store = new();
    private readonly AppSettings _settings;
    private readonly WindowService _panel;
    private readonly TrayService _tray;
    private readonly MarketClient _market = new();
    private MouseEdgeService? _mouse = null;
    private bool _closed, _exiting, _dialogOpen, _ready;
    private Task? _initialization;
    public MainWindow()
    {
        InitializeComponent();
        _settings = _store.Load();
        _panel = new WindowService(this, _settings);
        _tray = new TrayService(DispatcherQueue, () => _panel.Show(true), () => _panel.Hide(), OpenSettings, () => { _exiting = true; Close(); });
        AppWindow.Closing += (_, e) => { if (!_exiting) { e.Cancel = true; _panel.Hide(); } };
        Closed += (_, _) => { _closed = true; _market.Dispose(); _mouse?.Dispose(); _tray.Dispose(); _panel.Dispose(); Browser.Close(); };
    }
    public async void Start()
    {
#if SMOKE_TEST
        _panel.SuspendAutoHide = true;
#else
        try { _mouse = new MouseEdgeService(_panel, DispatcherQueue); }
        catch (Exception ex) { ShowNotice(ex.Message + " Use the tray to reveal the panel."); }
#endif
        if (_store.LoadWarning != null) ShowNotice(_store.LoadWarning);
        if (!Array.Exists(Environment.GetCommandLineArgs(), x => x == "--startup")) _panel.Show(true);
        await LoadAsync();
#if SMOKE_TEST
        _ = RunSmokeAsync();
#endif
    }
#if SMOKE_TEST
    private async Task RunSmokeAsync()
    {
        string output = Path.Combine(AppContext.BaseDirectory, "smoke-test.json");
        try
        {
            async Task<string> Read(string script) => await Browser.CoreWebView2.ExecuteScriptAsync(script);
            var deadline = DateTimeOffset.UtcNow.AddSeconds(60);
            while (DateTimeOffset.UtcNow < deadline && (!_ready || await Read("state.items.length > 0") != "true"))
                await Task.Delay(500);
            if (!_ready) throw new InvalidOperationException("Dashboard bridge did not initialize.");
            await Read("(async () => { const item = state.items.find(x => x.slug === 'ash_prime_set') || state.items[0]; if (item) await selectItem(item); })()");
            deadline = DateTimeOffset.UtcNow.AddSeconds(30);
            while (DateTimeOffset.UtcNow < deadline && await Read("state.orders.length > 0") != "true") await Task.Delay(500);
            await Read("if (state.selected && state.variant && !state.watch.length) toggleWatch()");
            await Read("loadHistorical(state.selected)");
            deadline = DateTimeOffset.UtcNow.AddSeconds(30);
            while (DateTimeOffset.UtcNow < deadline && await Read("Object.values(state.statistics).some(e => Object.values(e.series).some(s => s.hourly.length >= 24))") != "true") await Task.Delay(500);
            if (await Read("Object.values(state.statistics).some(e => Object.values(e.series).some(s => s.hourly.length >= 24))") != "true")
                throw new InvalidOperationException("Historical prices did not load.");
            string highlights = await Read("""
                (() => {
                  const original = state.statistics, now = Date.now(), item = state.selected;
                  const series = end => Array.from({length:25}, (_,i) => ({time:now-(24-i)*3600000-1000,median:100+(end-100)*i/24}));
                  try {
                    state.statistics = {sample:{platform:document.getElementById('platform').value,itemId:item.id,series:{[A.variant({})]:{hourly:series(110),daily:[],label:'Standard'},[A.variant({rank:10})]:{hourly:series(101),daily:[],label:'Rank 10'}}}};
                    chooseHighlightTab('rising');
                    const rising = document.querySelectorAll('#highlights .highlight-row').length === 1 && document.getElementById('rising-tab').getAttribute('aria-selected') === 'true';
                    document.getElementById('holding-tab').click();
                    const holding = document.querySelectorAll('#highlights .highlight-row').length === 1 && document.getElementById('holding-tab').getAttribute('aria-selected') === 'true';
                    return rising && holding;
                  } finally { state.statistics = original; chooseHighlightTab('rising'); }
                })()
                """);
            if (highlights != "true") throw new InvalidOperationException("Market highlight tabs did not render the expected rows.");
            string result = await Read("JSON.stringify({ title:document.title, catalog:state.items.length, selected:state.selected?.slug, orders:state.orders.length, lowest:document.getElementById('lowest').textContent, feedStatus:document.getElementById('status').textContent, feedEntries:state.feed.length, watch:state.watch.length, stored:!!localStorage.getItem('wfmt-v1'), error:document.getElementById('error').textContent, overflow:document.documentElement.scrollWidth > innerWidth })");
            string? json = JsonSerializer.Deserialize<string>(result);
            var scroll = await Read("window.scrollY");
            _panel.Hide(); await Task.Delay(350); _panel.Show(true); await Task.Delay(350);
            bool retained = await Read("window.scrollY") == scroll && await Read("state.watch.length") == "1";
            File.WriteAllText(output, "{\"historicalPrices\":true,\"highlightsTabs\":true,\"retainedOnHide\":" + retained.ToString().ToLowerInvariant() + ",\"dashboard\":" + json + "}");
        }
        catch (Exception ex) { File.WriteAllText(output, JsonSerializer.Serialize(new { error = ex.ToString() })); }
        finally { await Task.Delay(TimeSpan.FromSeconds(30)); _exiting = true; Close(); }
    }
#endif
    private async Task LoadAsync()
    {
        try
        {
            _initialization ??= InitializeBrowserAsync();
            await _initialization;
            if (_closed) return;
            ErrorPanel.Visibility = Visibility.Collapsed;
            Browser.CoreWebView2.Navigate(Dashboard);
        }
        catch (Exception ex) { _initialization = null; if (!_closed) ShowError(ex.Message); }
    }
    private async Task InitializeBrowserAsync()
    {
        Directory.CreateDirectory(SettingsService.DataFolder);
        var environment = await CoreWebView2Environment.CreateWithOptionsAsync(null, Path.Combine(SettingsService.DataFolder, "WebView2"), new CoreWebView2EnvironmentOptions());
        await Browser.EnsureCoreWebView2Async(environment);
        if (_closed) return;
        var core = Browser.CoreWebView2;
        core.SetVirtualHostNameToFolderMapping("app.wfmarkettrends.local", Path.Combine(AppContext.BaseDirectory, "Web"), CoreWebView2HostResourceAccessKind.Deny);
        core.Settings.AreDevToolsEnabled = true;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.NavigationStarting += (_, e) => { _ready = false; if (e.Uri != Dashboard) e.Cancel = true; };
        core.NewWindowRequested += (_, e) => e.Handled = true;
        core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
        core.NavigationCompleted += (_, e) => { if (!e.IsSuccess) ShowError("Dashboard navigation failed: " + e.WebErrorStatus); };
        core.ProcessFailed += (_, _) => ShowError("The dashboard stopped. Select Retry; if this persists, exit and reopen the app.");
        core.WebMessageReceived += Receive;
    }
    private async void Receive(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (e.Source != Dashboard || _closed) return;
        string? id = null;
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var message = doc.RootElement;
            id = message.GetProperty("id").GetString();
            var kind = message.GetProperty("kind").GetString();
            if (kind == "ready") { _ready = true; Send(new { id, data = true }); return; }
            var platform = message.GetProperty("platform").GetString() ?? "pc";
            var crossplay = message.GetProperty("crossplay").GetBoolean();
            if (kind == "subscribe") { _market.StartFeed(platform, crossplay, Send); Send(new { id, data = true }); }
            else if (kind is "items" or "orders" or "statistics")
            {
                string? slug = message.TryGetProperty("slug", out var value) ? value.GetString() : null;
                var data = await _market.GetAsync(kind, slug, platform, crossplay);
                Send(new { id, data });
            }
            else throw new ArgumentException("Unknown dashboard command.");
        }
        catch (Exception ex) { if (!_closed) Send(new { id, error = ex.Message }); }
    }
    private void Send(object message)
    {
        var json = JsonSerializer.Serialize(message);
        DispatcherQueue.TryEnqueue(() => { if (!_closed && _ready && Browser.CoreWebView2 != null) Browser.CoreWebView2.PostWebMessageAsJson(json); });
    }
    private void ShowNotice(string message) { Notice.Message = message; Notice.IsOpen = true; }
    private void ShowError(string message) { ErrorDetails.Text = message; ErrorPanel.Visibility = Visibility.Visible; }
    private void Hide_Click(object sender, RoutedEventArgs e) => _panel.Hide();
    private void Settings_Click(object sender, RoutedEventArgs e) => OpenSettings();
    private async void Retry_Click(object sender, RoutedEventArgs e) => await LoadAsync();
    private async void OpenSettings()
    {
        if (_dialogOpen || Root.XamlRoot == null) return;
        _dialogOpen = true; _panel.SuspendAutoHide = true; _panel.Show(true);
        var width = new NumberBox { Header = "Width (logical pixels)", Minimum = 320, Maximum = 3840, Value = _settings.PanelWidth };
        var height = new NumberBox { Header = "Height (logical pixels)", Minimum = 360, Maximum = 2160, Value = _settings.PanelHeight };
        var position = new ComboBox { Header = "Position", ItemsSource = new[] { "Left", "Middle", "Right" }, SelectedItem = _settings.Position };
        var startup = new CheckBox { Content = "Start with Windows", IsChecked = _settings.StartWithWindows };
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(position); content.Children.Add(width); content.Children.Add(height); content.Children.Add(startup);
        var dialog = new ContentDialog { XamlRoot = Root.XamlRoot, Title = "Panel settings", Content = new ScrollViewer { Content = content }, PrimaryButtonText = "Save", CloseButtonText = "Cancel" };
        try
        {
            if (await dialog.ShowAsync() != ContentDialogResult.Primary || _closed) return;
            StartupService.SetEnabled(startup.IsChecked == true);
            _settings.StartWithWindows = startup.IsChecked == true;
            _settings.PanelWidth = SettingsService.Clamp(width.Value, 320, 3840, 520);
            _settings.PanelHeight = SettingsService.Clamp(height.Value, 360, 2160, 844);
            _settings.Position = position.SelectedItem as string ?? "Middle";
            _store.Save(_settings); _panel.RefreshGeometry();
        }
        catch (Exception ex) { ShowNotice("Settings could not be saved. " + ex.Message); }
        finally { _dialogOpen = false; _panel.SuspendAutoHide = false; }
    }
}
