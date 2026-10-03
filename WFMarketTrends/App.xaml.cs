using Microsoft.UI.Xaml;
using System.Threading;

namespace WFMarketTrends;

public partial class App : Application
{
    private MainWindow? _window;
    private Mutex? _instance;

    public App() => InitializeComponent();

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _instance = new Mutex(true,
#if SMOKE_TEST
            "Local\\WFMarketTrends.SmokeTest",
#else
            "Local\\WFMarketTrends.Desktop",
#endif
            out bool first);
        if (!first) { Exit(); return; }
        _window = new MainWindow();
        _window.Closed += (_, _) => { _instance.ReleaseMutex(); _instance.Dispose(); };
        _window.Start();
    }
}
